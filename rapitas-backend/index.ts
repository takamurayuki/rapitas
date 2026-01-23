import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";
import {
  analyzeTask,
  generateExecutionInstructions,
  isApiKeyConfigured,
  type SubtaskProposal,
} from "./services/claude-agent";
import { GitHubService } from "./services/github-service";
import { agentFactory } from "./services/agents/agent-factory";
import { createOrchestrator } from "./services/agents/agent-orchestrator";
import { realtimeService } from "./services/realtime-service";
import { encrypt, decrypt, maskApiKey } from "./utils/encryption";

const app = new Elysia();
const prisma = new PrismaClient();

app.use(cors());

// エラーハンドリング
app.onError(({ code, error, set }: { code: any; error: any; set: any }) => {
  if (code === "VALIDATION") {
    set.status = 400;
    return { error: "バリデーションエラー", details: error.message };
  }
  if (code === "NOT_FOUND") {
    set.status = 404;
    return { error: "リソースが見つかりません" };
  }
  console.error(error);
  set.status = 500;
  return { error: "サーバーエラーが発生しました" };
});

// ==================== Themes API ====================
app.get("/themes", async () => {
  return await prisma.theme.findMany({
    include: {
      _count: {
        select: { tasks: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/themes/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.theme.findUnique({
    where: { id: parseInt(id) },
    include: {
      tasks: {
        where: { parentId: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

app.post(
  "/themes",
  async ({ body }: { body: any }) => {
    const { name, description, color, icon } = body;
    return await prisma.theme.create({
      data: {
        name,
        ...(description && { description }),
        ...(color && { color }),
        ...(icon && { icon }),
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      color: t.Optional(t.String()),
      icon: t.Optional(t.String()),
    }),
  },
);

app.patch(
  "/themes/:id",
  async ({ params, body }: { params: any; body: any }) => {
    const { id } = params;
    const { name, description, color, icon } = body as {
      name?: string;
      description?: string;
      color?: string;
      icon?: string;
    };
    return await prisma.theme.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(color && { color }),
        ...(icon !== undefined && { icon }),
      },
    });
  },
);

app.delete("/themes/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.theme.delete({
    where: { id: parseInt(id) },
  });
});

// デフォルトテーマ設定
app.patch(
  "/themes/:id/set-default",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    const themeId = parseInt(id);

    // まず全てのテーマのisDefaultをfalseにする
    await prisma.theme.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });

    // 指定されたテーマをデフォルトにする
    return await prisma.theme.update({
      where: { id: themeId },
      data: { isDefault: true },
    });
  },
);

// デフォルトテーマ取得
app.get("/themes/default/get", async () => {
  return await prisma.theme.findFirst({
    where: { isDefault: true },
  });
});

// ==================== Labels API ====================
app.get("/labels", async () => {
  return await prisma.label.findMany({
    include: {
      _count: {
        select: { tasks: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/labels/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.label.findUnique({
    where: { id: parseInt(id) },
    include: {
      tasks: {
        include: {
          task: true,
        },
      },
    },
  });
});

app.post(
  "/labels",
  async ({ body }: { body: any }) => {
    const { name, description, color, icon } = body;
    return await prisma.label.create({
      data: {
        name,
        ...(description && { description }),
        ...(color && { color }),
        ...(icon && { icon }),
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      color: t.Optional(t.String()),
      icon: t.Optional(t.String()),
    }),
  },
);

app.patch(
  "/labels/:id",
  async ({ params, body }: { params: any; body: any }) => {
    const { id } = params;
    const { name, description, color, icon } = body as {
      name?: string;
      description?: string;
      color?: string;
      icon?: string;
    };
    return await prisma.label.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(color && { color }),
        ...(icon !== undefined && { icon }),
      },
    });
  },
);

app.delete("/labels/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.label.delete({
    where: { id: parseInt(id) },
  });
});

// タスクのラベル一括更新
app.put(
  "/tasks/:id/labels",
  async ({ params, body }: { params: { id: string }; body: any }) => {
    const { id } = params;
    const { labelIds } = body as { labelIds: number[] };
    const taskIdNum = parseInt(id);

    // 既存の関連を削除
    await prisma.taskLabel.deleteMany({
      where: { taskId: taskIdNum },
    });

    // 新しい関連を作成
    if (labelIds && labelIds.length > 0) {
      await prisma.taskLabel.createMany({
        data: labelIds.map((labelId) => ({
          taskId: taskIdNum,
          labelId,
        })),
      });
    }

    // 更新後のタスクを返す
    return await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        taskLabels: {
          include: {
            label: true,
          },
        },
      },
    });
  },
);

// ==================== Projects API ====================
app.get("/projects", async () => {
  return await prisma.project.findMany({
    include: {
      _count: {
        select: { tasks: true, milestones: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/projects/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.project.findUnique({
    where: { id: parseInt(id) },
    include: {
      milestones: {
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { tasks: true } },
        },
      },
      tasks: {
        where: { parentId: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

app.post(
  "/projects",
  async ({ body }: { body: any }) => {
    const { name, description, color, icon } = body;
    return await prisma.project.create({
      data: {
        name,
        ...(description && { description }),
        ...(color && { color }),
        ...(icon && { icon }),
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      color: t.Optional(t.String()),
      icon: t.Optional(t.String()),
    }),
  },
);

app.patch(
  "/projects/:id",
  async ({ params, body }: { params: any; body: any }) => {
    const { id } = params;
    const { name, description, color, icon } = body as {
      name?: string;
      description?: string;
      color?: string;
      icon?: string;
    };
    return await prisma.project.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(color && { color }),
        ...(icon !== undefined && { icon }),
      },
    });
  },
);

app.delete("/projects/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.project.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Milestones API ====================
app.get("/milestones", async ({ query }: { query: { projectId?: string } }) => {
  const { projectId } = query;
  return await prisma.milestone.findMany({
    where: projectId ? { projectId: parseInt(projectId) } : undefined,
    include: {
      project: true,
      _count: { select: { tasks: true } },
    },
    orderBy: { createdAt: "asc" },
  });
});

app.get("/milestones/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.milestone.findUnique({
    where: { id: parseInt(id) },
    include: {
      project: true,
      tasks: {
        where: { parentId: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

app.post(
  "/milestones",
  async ({ body }: { body: any }) => {
    const { name, description, dueDate, projectId } = body;
    return await prisma.milestone.create({
      data: {
        name,
        projectId,
        ...(description && { description }),
        ...(dueDate && { dueDate: new Date(dueDate) }),
      },
      include: {
        project: true,
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      projectId: t.Number(),
      description: t.Optional(t.String()),
      dueDate: t.Optional(t.String()),
    }),
  },
);

app.patch(
  "/milestones/:id",
  async ({ params, body }: { params: any; body: any }) => {
    const { id } = params;
    const { name, description, dueDate } = body as {
      name?: string;
      description?: string;
      dueDate?: string;
    };
    return await prisma.milestone.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(dueDate !== undefined && {
          dueDate: dueDate ? new Date(dueDate) : null,
        }),
      },
    });
  },
);

app.delete("/milestones/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.milestone.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Tasks API ====================
app.get(
  "/tasks",
  async ({
    query,
  }: {
    query: { projectId?: string; milestoneId?: string; priority?: string };
  }) => {
    const { projectId, milestoneId, priority } = query;

    return await prisma.task.findMany({
      where: {
        parentId: null,
        ...(projectId && { projectId: parseInt(projectId) }),
        ...(milestoneId && { milestoneId: parseInt(milestoneId) }),
        ...(priority && { priority }),
      },
      include: {
        subtasks: {
          orderBy: { createdAt: "asc" },
        },
        theme: true,
        project: true,
        milestone: true,
        examGoal: true,
        taskLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },
);

app.get("/tasks/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.task.findUnique({
    where: { id: parseInt(id) },
    // @ts-ignore
    include: {
      subtasks: {
        orderBy: { createdAt: "asc" },
      },
      theme: true,
      project: true,
      milestone: true,
      examGoal: true,
      taskLabels: {
        include: {
          label: true,
        },
      },
    },
  });
});

app.post(
  "/tasks",
  async ({ body }: { body: any }) => {
    const {
      title,
      description,
      status,
      priority,
      labels,
      labelIds,
      estimatedHours,
      dueDate,
      subject,
      parentId,
      projectId,
      milestoneId,
      themeId,
      examGoalId,
    } = body;
    const task = await prisma.task.create({
      data: {
        title,
        ...(description && { description }),
        status: status ?? "todo",
        // @ts-ignore
        priority: priority ?? "medium",
        ...(labels && { labels }),
        ...(estimatedHours && { estimatedHours }),
        ...(dueDate && { dueDate: new Date(dueDate) }),
        ...(subject && { subject }),
        ...(parentId && { parentId }),
        ...(projectId && { projectId }),
        ...(milestoneId && { milestoneId }),
        ...(themeId !== undefined && { themeId }),
        ...(examGoalId !== undefined && { examGoalId }),
      },
    });

    // ラベルの関連付け
    if (labelIds && labelIds.length > 0) {
      await prisma.taskLabel.createMany({
        data: labelIds.map((labelId: number) => ({
          taskId: task.id,
          labelId,
        })),
      });
    }

    // @ts-ignore
    return await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        subtasks: true,
        theme: true,
        project: true,
        milestone: true,
        examGoal: true,
        taskLabels: {
          include: {
            label: true,
          },
        },
      },
    });
  },
  {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      status: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      labels: t.Optional(t.Array(t.String())),
      labelIds: t.Optional(t.Array(t.Number())),
      estimatedHours: t.Optional(t.Number()),
      dueDate: t.Optional(t.String()),
      subject: t.Optional(t.String()),
      parentId: t.Optional(t.Number()),
      projectId: t.Optional(t.Number()),
      milestoneId: t.Optional(t.Number()),
      themeId: t.Optional(t.Number()),
      examGoalId: t.Optional(t.Number()),
    }),
  },
);

app.patch(
  "/tasks/:id",
  async ({ params, body }: { params: { id: string }; body: any }) => {
    const { id } = params;
    const taskId = parseInt(id);
    const {
      title,
      description,
      themeId,
      status,
      priority,
      labels,
      labelIds,
      estimatedHours,
      dueDate,
      subject,
      projectId,
      milestoneId,
      examGoalId,
    } = body as {
      title?: string;
      description?: string;
      themeId?: number | null;
      status?: string;
      priority?: string;
      labels?: string[];
      labelIds?: number[];
      estimatedHours?: number;
      dueDate?: string | null;
      subject?: string | null;
      projectId?: number | null;
      milestoneId?: number | null;
      examGoalId?: number | null;
    };

    // タスク完了時にストリークを記録
    if (status === "done") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await prisma.studyStreak.upsert({
        where: { date: today },
        update: { tasksCompleted: { increment: 1 } },
        create: { date: today, studyMinutes: 0, tasksCompleted: 1 },
      });
    }

    await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(themeId !== undefined && { themeId }),
        ...(status && { status }),
        ...(status === "done" && { completedAt: new Date() }),
        // @ts-ignore
        ...(priority && { priority }),
        ...(labels && { labels }),
        ...(estimatedHours !== undefined && { estimatedHours }),
        ...(dueDate !== undefined && {
          dueDate: dueDate ? new Date(dueDate) : null,
        }),
        ...(subject !== undefined && { subject }),
        ...(projectId !== undefined && { projectId }),
        ...(milestoneId !== undefined && { milestoneId }),
        ...(examGoalId !== undefined && { examGoalId }),
      },
    });

    // ラベルの更新（labelIdsが提供された場合）
    if (labelIds !== undefined) {
      await prisma.taskLabel.deleteMany({
        where: { taskId },
      });
      if (labelIds.length > 0) {
        await prisma.taskLabel.createMany({
          data: labelIds.map((labelId) => ({
            taskId,
            labelId,
          })),
        });
      }
    }

    // @ts-ignore
    return await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
        project: true,
        milestone: true,
        examGoal: true,
        taskLabels: {
          include: {
            label: true,
          },
        },
      },
    });
  },
);

app.delete("/tasks/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.task.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Time Entries API ====================
app.get("/tasks/:id/time-entries", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.timeEntry.findMany({
    where: { taskId: parseInt(id) },
    orderBy: { startedAt: "desc" },
  });
});

app.post(
  "/tasks/:id/time-entries",
  async ({ params, body }: { params: any; body: any }) => {
    const { id } = params;
    const { duration, note, startedAt, endedAt } = body;
    return await prisma.timeEntry.create({
      data: {
        taskId: parseInt(id),
        duration,
        note,
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
      },
    });
  },
  {
    body: t.Object({
      duration: t.Number({ minimum: 0 }),
      startedAt: t.String(),
      endedAt: t.String(),
      note: t.Optional(t.String()),
    }),
  },
);

// ==================== Comments API ====================
app.get(
  "/tasks/:id/comments",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.comment.findMany({
      where: { taskId: parseInt(id) },
      orderBy: { createdAt: "desc" },
    });
  },
);

app.post(
  "/tasks/:id/comments",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { content: string };
  }) => {
    const { id } = params;
    const { content } = body;
    return await prisma.comment.create({
      data: {
        taskId: parseInt(id),
        content,
      },
    });
  },
  {
    body: t.Object({
      content: t.String({ minLength: 1 }),
    }),
  },
);

// ==================== Exam Goals API ====================
app.get("/exam-goals", async () => {
  return await prisma.examGoal.findMany({
    include: {
      _count: {
        select: { tasks: true },
      },
    },
    orderBy: { examDate: "asc" },
  });
});

app.get("/exam-goals/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.examGoal.findUnique({
    where: { id: parseInt(id) },
    include: {
      tasks: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

app.post(
  "/exam-goals",
  async ({
    body,
  }: {
    body: {
      name: string;
      description?: string;
      examDate: string;
      targetScore?: string;
      color?: string;
      icon?: string;
    };
  }) => {
    const { name, description, examDate, targetScore, color, icon } = body;
    return await prisma.examGoal.create({
      data: {
        name,
        examDate: new Date(examDate),
        ...(description && { description }),
        ...(targetScore && { targetScore }),
        ...(color && { color }),
        ...(icon && { icon }),
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      examDate: t.String(),
      description: t.Optional(t.String()),
      targetScore: t.Optional(t.String()),
      color: t.Optional(t.String()),
      icon: t.Optional(t.String()),
    }),
  },
);

app.patch(
  "/exam-goals/:id",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: {
      name?: string;
      description?: string;
      examDate?: string;
      targetScore?: string;
      color?: string;
      icon?: string;
      isCompleted?: boolean;
      actualScore?: string;
    };
  }) => {
    const { id } = params;
    const {
      name,
      description,
      examDate,
      targetScore,
      color,
      icon,
      isCompleted,
      actualScore,
    } = body as {
      name?: string;
      description?: string;
      examDate?: string;
      targetScore?: string;
      color?: string;
      icon?: string;
      isCompleted?: boolean;
      actualScore?: string;
    };
    return await prisma.examGoal.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(examDate && { examDate: new Date(examDate) }),
        ...(targetScore !== undefined && { targetScore }),
        ...(color && { color }),
        ...(icon !== undefined && { icon }),
        ...(isCompleted !== undefined && { isCompleted }),
        ...(actualScore !== undefined && { actualScore }),
      },
    });
  },
);

app.delete("/exam-goals/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.examGoal.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Study Streak API ====================
app.get("/study-streaks", async ({ query }: { query: { days?: string } }) => {
  const { days } = query as { days?: string };
  const daysNum = days ? parseInt(days) : 30;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysNum);
  startDate.setHours(0, 0, 0, 0);

  return await prisma.studyStreak.findMany({
    where: {
      date: { gte: startDate },
    },
    orderBy: { date: "asc" },
  });
});

app.get("/study-streaks/current", async () => {
  // 現在のストリークを計算
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let currentStreak = 0;
  let checkDate = new Date(today);

  while (true) {
    const streak = await prisma.studyStreak.findUnique({
      where: { date: checkDate },
    });

    if (streak && (streak.studyMinutes > 0 || streak.tasksCompleted > 0)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // 最長ストリークを計算
  const allStreaks = await prisma.studyStreak.findMany({
    orderBy: { date: "asc" },
  });

  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate: Date | null = null;

  for (const streak of allStreaks) {
    if (streak.studyMinutes > 0 || streak.tasksCompleted > 0) {
      if (prevDate) {
        const diff = Math.round(
          (streak.date.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (diff === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
      } else {
        tempStreak = 1;
      }
      longestStreak = Math.max(longestStreak, tempStreak);
      prevDate = streak.date;
    } else {
      tempStreak = 0;
      prevDate = null;
    }
  }

  return {
    currentStreak,
    longestStreak,
    today: today.toISOString(),
  };
});

app.post("/study-streaks/record", async ({ body }: { body: any }) => {
  const { date, studyMinutes, tasksCompleted } = body as {
    date?: string | null;
    studyMinutes?: number | null;
    tasksCompleted?: number | null;
  };

  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);

  return await prisma.studyStreak.upsert({
    where: { date: targetDate },
    update: {
      ...(studyMinutes !== undefined && {
        studyMinutes: { increment: studyMinutes },
      }),
      ...(tasksCompleted !== undefined && {
        tasksCompleted: { increment: tasksCompleted },
      }),
    },
    create: {
      date: targetDate,
      studyMinutes: studyMinutes || 0,
      tasksCompleted: tasksCompleted || 0,
    },
  });
});

// ==================== Study Plan API ====================
app.get("/study-plans", async () => {
  return await prisma.studyPlan.findMany({
    orderBy: { createdAt: "desc" },
  });
});

app.get("/study-plans/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.studyPlan.findUnique({
    where: { id: parseInt(id) },
  });
});

app.post("/study-plans", async ({ body }: { body: any }) => {
  const {
    examGoalId,
    subject,
    prompt,
    generatedPlan,
    totalDays,
    startDate,
    endDate,
  } = body as {
    examGoalId?: number | null;
    subject: string;
    prompt: string;
    generatedPlan: any;
    totalDays: number;
    startDate: string;
    endDate: string;
  };
  return await prisma.studyPlan.create({
    data: {
      subject,
      prompt,
      generatedPlan,
      totalDays,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      ...(examGoalId && { examGoalId }),
    },
  });
});

app.patch(
  "/study-plans/:id",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { isApplied?: boolean };
  }) => {
    const { id } = params;
    const { isApplied } = body as { isApplied?: boolean };
    return await prisma.studyPlan.update({
      where: { id: parseInt(id) },
      data: {
        ...(isApplied !== undefined && { isApplied }),
      },
    });
  },
);

// 学習プランをタスクに適用
app.post(
  "/study-plans/:id/apply",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    const studyPlan = await prisma.studyPlan.findUnique({
      where: { id: parseInt(id) },
    });
    if (!studyPlan) return { error: "Study plan not found" };

    const plan = studyPlan.generatedPlan as {
      phases: {
        name: string;
        days: number;
        tasks: string[];
        dailyHours: number;
      }[];
    };
    const createdTasks = [];
    let currentDate = new Date(studyPlan.startDate);

    // 各フェーズのタスクを作成
    for (const phase of plan.phases) {
      const phaseDays = phase.days;
      const phaseEndDate = new Date(currentDate);
      phaseEndDate.setDate(phaseEndDate.getDate() + phaseDays);

      for (const taskTitle of phase.tasks) {
        const task = await prisma.task.create({
          data: {
            title: `[${studyPlan.subject}] ${taskTitle}`,
            description: `学習計画「${studyPlan.subject}」のフェーズ「${phase.name}」のタスクです。\n\n目標: 1日${phase.dailyHours}時間`,
            status: "todo",
            subject: studyPlan.subject,
            estimatedHours: phase.dailyHours,
            dueDate: phaseEndDate,
            ...(studyPlan.examGoalId && { examGoalId: studyPlan.examGoalId }),
          },
        });
        createdTasks.push(task);
      }

      currentDate = phaseEndDate;
    }

    // 学習プランを適用済みに更新
    await prisma.studyPlan.update({
      where: { id: parseInt(id) },
      data: { isApplied: true },
    });

    return { createdTasks, count: createdTasks.length };
  },
);

app.delete(
  "/study-plans/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.studyPlan.delete({
      where: { id: parseInt(id) },
    });
  },
);

// AI学習計画生成（モックAPI - 実際のAI連携は後で追加）
app.post(
  "/study-plans/generate",
  async ({
    body,
  }: {
    body: {
      subject: string | null;
      examDate: string | null;
      targetScore?: string | null;
      studyHoursPerDay: number | null;
      currentLevel: string | null;
    };
  }) => {
    const { subject, examDate, targetScore, studyHoursPerDay, currentLevel } =
      body as {
        subject: string | null;
        examDate: string | null;
        targetScore?: string | null;
        studyHoursPerDay: number | null;
        currentLevel: string | null; // beginner, intermediate, advanced
      };

    const start = new Date();
    const end = new Date(examDate || "");
    const totalDays = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    );

    // AIによる計画生成をシミュレート（実際にはOpenAI APIを呼び出す）
    const phases = [];
    const phaseDays = Math.floor(totalDays / 3);

    phases.push({
      name: "基礎固め",
      days: phaseDays,
      tasks: [
        `${subject}の基本概念を学習`,
        `${subject}の用語を暗記`,
        "過去問を確認して傾向を把握",
      ],
      dailyHours: Number(studyHoursPerDay) * 0.8,
    });

    phases.push({
      name: "応用力強化",
      days: phaseDays,
      tasks: [
        `${subject}の応用問題に取り組む`,
        "弱点分野を重点的に学習",
        "模擬試験を解く",
      ],
      dailyHours: Number(studyHoursPerDay),
    });

    phases.push({
      name: "総仕上げ",
      days: totalDays - phaseDays * 2,
      tasks: [
        "過去問を時間を計って解く",
        "間違えた問題の復習",
        `${targetScore ? `目標${targetScore}達成のための最終調整` : "試験本番に向けた最終確認"}`,
      ],
      dailyHours: Number(studyHoursPerDay) * 1.2,
    });

    const generatedPlan = {
      subject,
      targetScore,
      totalDays,
      studyHoursPerDay,
      phases,
      tips: [
        "毎日同じ時間に学習する習慣をつけましょう",
        "休憩を適度に取り、集中力を維持しましょう",
        "復習は記憶定着に重要です",
      ],
    };

    return {
      generatedPlan,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalDays,
    };
  },
);

// ==================== Dashboard Statistics API ====================
app.get("/statistics/overview", async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  // タスク統計
  const totalTasks = await prisma.task.count({ where: { parentId: null } });
  const completedTasks = await prisma.task.count({
    where: { parentId: null, status: "done" },
  });
  const todayCompleted = await prisma.task.count({
    where: {
      parentId: null,
      status: "done",
      completedAt: { gte: today },
    },
  });
  const weekCompleted = await prisma.task.count({
    where: {
      parentId: null,
      status: "done",
      completedAt: { gte: weekAgo },
    },
  });

  // 学習時間統計
  const weekTimeEntries = await prisma.timeEntry.findMany({
    where: { startedAt: { gte: weekAgo } },
  });
  const weekStudyHours = weekTimeEntries.reduce(
    (sum: number, entry: { duration: number }) => sum + entry.duration,
    0,
  );

  const monthTimeEntries = await prisma.timeEntry.findMany({
    where: { startedAt: { gte: monthAgo } },
  });
  const monthStudyHours = monthTimeEntries.reduce(
    (sum: number, entry: { duration: number }) => sum + entry.duration,
    0,
  );

  // 試験目標
  const upcomingExams = await prisma.examGoal.findMany({
    where: {
      examDate: { gte: today },
      isCompleted: false,
    },
    orderBy: { examDate: "asc" },
    take: 5,
  });

  // ストリーク
  const streakData = await prisma.studyStreak.findMany({
    where: { date: { gte: weekAgo } },
    orderBy: { date: "asc" },
  });

  return {
    tasks: {
      total: totalTasks,
      completed: completedTasks,
      todayCompleted,
      weekCompleted,
      completionRate:
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    },
    studyTime: {
      weekHours: Math.round(weekStudyHours * 10) / 10,
      monthHours: Math.round(monthStudyHours * 10) / 10,
    },
    upcomingExams,
    streakData,
  };
});

// 日別学習時間
app.get(
  "/statistics/daily-study",
  async ({ query }: { query: { days?: string } }) => {
    const daysNum = query.days ? parseInt(query.days) : 7;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    const timeEntries = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: startDate } },
      orderBy: { startedAt: "asc" },
    });

    // 日別に集計
    const dailyData: Record<string, number> = {};
    for (let i = 0; i < daysNum; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      dailyData[String(dateStr)] = 0;
    }

    for (const entry of timeEntries) {
      const dateStr = entry.startedAt.toISOString().split("T")[0];
      if (dailyData[dateStr] !== undefined) {
        dailyData[dateStr] += entry.duration;
      }
    }

    return Object.entries(dailyData).map(([date, hours]) => ({
      date,
      hours: Math.round(hours * 10) / 10,
    }));
  },
);

// 科目別学習時間
app.get(
  "/statistics/subject-breakdown",
  async ({ query }: { query: { days?: string } }) => {
    const daysNum = query.days ? parseInt(query.days) : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);

    const tasks = await prisma.task.findMany({
      where: {
        subject: { not: null },
        timeEntries: {
          some: {
            startedAt: { gte: startDate },
          },
        },
      },
      include: {
        timeEntries: {
          where: { startedAt: { gte: startDate } },
        },
      },
    });

    const subjectData: Record<string, number> = {};
    for (const task of tasks) {
      if (task.subject) {
        const hours = task.timeEntries.reduce(
          (sum: number, e: { duration: number }) => sum + e.duration,
          0,
        );
        subjectData[task.subject] = (subjectData[task.subject] || 0) + hours;
      }
    }

    return Object.entries(subjectData)
      .map(([subject, hours]) => ({
        subject,
        hours: Math.round(hours * 10) / 10,
      }))
      .sort((a, b) => b.hours - a.hours);
  },
);

// ==================== Achievements API ====================
// 初期実績データを作成
const ACHIEVEMENTS = [
  {
    key: "first_task",
    name: "はじめの一歩",
    description: "最初のタスクを完了",
    icon: "Star",
    color: "#FFD700",
    category: "tasks",
    condition: { type: "tasks_completed", count: 1 },
    rarity: "common",
  },
  {
    key: "task_10",
    name: "やる気満々",
    description: "10個のタスクを完了",
    icon: "Zap",
    color: "#F59E0B",
    category: "tasks",
    condition: { type: "tasks_completed", count: 10 },
    rarity: "common",
  },
  {
    key: "task_50",
    name: "努力家",
    description: "50個のタスクを完了",
    icon: "Award",
    color: "#8B5CF6",
    category: "tasks",
    condition: { type: "tasks_completed", count: 50 },
    rarity: "rare",
  },
  {
    key: "task_100",
    name: "タスクマスター",
    description: "100個のタスクを完了",
    icon: "Crown",
    color: "#EC4899",
    category: "tasks",
    condition: { type: "tasks_completed", count: 100 },
    rarity: "epic",
  },
  {
    key: "streak_3",
    name: "継続は力なり",
    description: "3日連続で学習",
    icon: "Flame",
    color: "#F97316",
    category: "streak",
    condition: { type: "streak", days: 3 },
    rarity: "common",
  },
  {
    key: "streak_7",
    name: "一週間の壁突破",
    description: "7日連続で学習",
    icon: "Flame",
    color: "#EF4444",
    category: "streak",
    condition: { type: "streak", days: 7 },
    rarity: "rare",
  },
  {
    key: "streak_30",
    name: "鉄人",
    description: "30日連続で学習",
    icon: "Flame",
    color: "#DC2626",
    category: "streak",
    condition: { type: "streak", days: 30 },
    rarity: "legendary",
  },
  {
    key: "study_10h",
    name: "学習の第一歩",
    description: "累計10時間学習",
    icon: "Clock",
    color: "#3B82F6",
    category: "study",
    condition: { type: "study_hours", hours: 10 },
    rarity: "common",
  },
  {
    key: "study_50h",
    name: "勉強熱心",
    description: "累計50時間学習",
    icon: "Clock",
    color: "#2563EB",
    category: "study",
    condition: { type: "study_hours", hours: 50 },
    rarity: "rare",
  },
  {
    key: "study_100h",
    name: "学習の達人",
    description: "累計100時間学習",
    icon: "BookOpen",
    color: "#1D4ED8",
    category: "study",
    condition: { type: "study_hours", hours: 100 },
    rarity: "epic",
  },
  {
    key: "exam_pass",
    name: "合格おめでとう",
    description: "試験目標を達成",
    icon: "Trophy",
    color: "#10B981",
    category: "exam",
    condition: { type: "exam_completed", count: 1 },
    rarity: "rare",
  },
  {
    key: "early_bird",
    name: "早起き学習",
    description: "朝6時前に学習開始",
    icon: "Sun",
    color: "#FBBF24",
    category: "special",
    condition: { type: "early_study" },
    rarity: "rare",
  },
  {
    key: "night_owl",
    name: "夜型学習者",
    description: "深夜0時以降に学習",
    icon: "Moon",
    color: "#6366F1",
    category: "special",
    condition: { type: "night_study" },
    rarity: "rare",
  },
  {
    key: "flashcard_master",
    name: "暗記王",
    description: "100枚のフラッシュカードを復習",
    icon: "Brain",
    color: "#8B5CF6",
    category: "flashcard",
    condition: { type: "flashcard_reviews", count: 100 },
    rarity: "rare",
  },
];

app.get("/achievements", async () => {
  // 実績マスタを取得または作成
  let achievements = await prisma.achievement.findMany({
    include: {
      unlockedBy: true,
    },
    orderBy: { id: "asc" },
  });

  // 初期データがなければ作成
  if (achievements.length === 0) {
    await prisma.achievement.createMany({
      data: ACHIEVEMENTS.map((a) => ({
        key: a.key,
        name: a.name,
        description: a.description,
        icon: a.icon,
        color: a.color,
        category: a.category,
        condition: a.condition,
        rarity: a.rarity,
      })),
    });
    achievements = await prisma.achievement.findMany({
      include: { unlockedBy: true },
      orderBy: { id: "asc" },
    });
  }

  return achievements.map((a: { unlockedBy: { unlockedAt: Date }[] }) => ({
    ...a,
    isUnlocked: a.unlockedBy.length > 0,
    unlockedAt: a.unlockedBy[0]?.unlockedAt || null,
  }));
});

app.post("/achievements/:key/unlock", async ({ params }: { params: any }) => {
  const { key } = params;
  const achievement = await prisma.achievement.findUnique({ where: { key } });
  if (!achievement) return { error: "Achievement not found" };

  const existing = await prisma.userAchievement.findUnique({
    where: { achievementId: achievement.id },
  });
  if (existing)
    return {
      ...achievement,
      isUnlocked: true,
      unlockedAt: existing.unlockedAt,
    };

  await prisma.userAchievement.create({
    data: { achievementId: achievement.id },
  });

  return { ...achievement, isUnlocked: true, unlockedAt: new Date() };
});

// 実績チェック（タスク完了時などに呼ばれる）
app.post("/achievements/check", async () => {
  const newlyUnlocked = [];

  // タスク完了数をチェック
  const completedTasks = await prisma.task.count({
    where: { status: "done", parentId: null },
  });

  // ストリークをチェック
  const streakRes = await fetch("http://localhost:3001/study-streaks/current");
  const streakData = (await streakRes.json()) as { currentStreak: number };
  const currentStreak = streakData.currentStreak || 0;

  // 学習時間をチェック
  const timeEntries = await prisma.timeEntry.findMany();
  const totalHours = timeEntries.reduce(
    (sum: number, e: { duration: number }) => sum + e.duration,
    0,
  );

  // 試験達成をチェック
  const completedExams = await prisma.examGoal.count({
    where: { isCompleted: true },
  });

  const achievements = await prisma.achievement.findMany({
    include: { unlockedBy: true },
  });

  for (const achievement of achievements) {
    if (achievement.unlockedBy.length > 0) continue;

    const condition = achievement.condition as any;
    let shouldUnlock = false;

    switch (condition.type) {
      case "tasks_completed":
        shouldUnlock = completedTasks >= condition.count;
        break;
      case "streak":
        shouldUnlock = currentStreak >= condition.days;
        break;
      case "study_hours":
        shouldUnlock = totalHours >= condition.hours;
        break;
      case "exam_completed":
        shouldUnlock = completedExams >= condition.count;
        break;
    }

    if (shouldUnlock) {
      await prisma.userAchievement.create({
        data: { achievementId: achievement.id },
      });
      newlyUnlocked.push(achievement);
    }
  }

  return { newlyUnlocked };
});

// ==================== Habits API ====================
app.get("/habits", async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return await prisma.habit.findMany({
    include: {
      logs: {
        where: { date: today },
      },
      _count: { select: { logs: true } },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get("/habits/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  return await prisma.habit.findUnique({
    where: { id: parseInt(id) },
    include: {
      logs: {
        where: { date: { gte: thirtyDaysAgo } },
        orderBy: { date: "desc" },
      },
    },
  });
});

app.post(
  "/habits",
  async ({
    body,
  }: {
    body: {
      name: string;
      description?: string;
      icon?: string;
      color?: string;
      frequency?: string;
      targetCount?: number;
    };
  }) => {
    const { name, description, icon, color, frequency, targetCount } = body;
    return await prisma.habit.create({
      data: {
        name,
        ...(description && { description }),
        ...(icon && { icon }),
        ...(color && { color }),
        ...(frequency && { frequency }),
        ...(targetCount && { targetCount }),
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      icon: t.Optional(t.String()),
      color: t.Optional(t.String()),
      frequency: t.Optional(t.String()),
      targetCount: t.Optional(t.Number()),
    }),
  },
);

app.patch(
  "/habits/:id",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: {
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      frequency?: string;
      targetCount?: number;
      isActive?: boolean;
    };
  }) => {
    const { id } = params;
    const { name, description, icon, color, frequency, targetCount, isActive } =
      body;
    return await prisma.habit.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
        ...(color && { color }),
        ...(frequency && { frequency }),
        ...(targetCount && { targetCount }),
        ...(isActive !== undefined && { isActive }),
      },
    });
  },
);

app.delete("/habits/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.habit.delete({ where: { id: parseInt(id) } });
});

app.post(
  "/habits/:id/log",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { date?: string; note?: string };
  }) => {
    const { id } = params;
    const { date, note } = body;

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    return await prisma.habitLog.upsert({
      where: {
        habitId_date: {
          habitId: parseInt(id),
          date: targetDate,
        },
      },
      update: {
        count: { increment: 1 },
        ...(note && { note }),
      },
      create: {
        habitId: parseInt(id),
        date: targetDate,
        count: 1,
        ...(note && { note }),
      },
    });
  },
);

// ==================== Resources API ====================
app.get("/tasks/:id/resources", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.resource.findMany({
    where: { taskId: parseInt(id) },
    orderBy: { createdAt: "desc" },
  });
});

app.post("/resources", async ({ body }: { body: any }) => {
  const { taskId, title, url, type, description } = body as {
    taskId?: number;
    title: string;
    url?: string;
    type: string;
    description?: string;
  };
  return await prisma.resource.create({
    data: {
      title,
      type,
      ...(taskId && { taskId }),
      ...(url && { url }),
      ...(description && { description }),
    },
  });
});

app.delete("/resources/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.resource.delete({ where: { id: parseInt(id) } });
});

// ==================== Flashcards API ====================
app.get("/flashcard-decks", async () => {
  return await prisma.flashcardDeck.findMany({
    include: {
      _count: { select: { cards: true } },
    },
    orderBy: { createdAt: "desc" },
  });
});

app.get(
  "/flashcard-decks/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.flashcardDeck.findUnique({
      where: { id: parseInt(id) },
      include: {
        cards: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  },
);

app.post(
  "/flashcard-decks",
  async ({
    body: { name, description, color, taskId },
  }: {
    body: {
      name: string;
      description?: string;
      color?: string;
      taskId?: number;
    };
  }) => {
    return await prisma.flashcardDeck.create({
      data: {
        name,
        ...(description && { description }),
        ...(color && { color }),
        ...(taskId && { taskId }),
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      color: t.Optional(t.String()),
      taskId: t.Optional(t.Number()),
    }),
  },
);

app.delete("/flashcard-decks/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.flashcardDeck.delete({ where: { id: parseInt(id) } });
});

app.post(
  "/flashcard-decks/:deckId/cards",
  async ({
    params,
    body,
  }: {
    params: { deckId: string };
    body: { front: string; back: string };
  }) => {
    const { deckId } = params;
    const { front, back } = body;
    return await prisma.flashcard.create({
      data: {
        deckId: parseInt(deckId),
        front,
        back,
      },
    });
  },
  {
    body: t.Object({
      front: t.String({ minLength: 1 }),
      back: t.String({ minLength: 1 }),
    }),
  },
);

app.patch(
  "/flashcards/:id",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { front?: string; back?: string };
  }) => {
    const { id } = params;
    const { front, back } = body as { front?: string; back?: string };
    return await prisma.flashcard.update({
      where: { id: parseInt(id) },
      data: {
        ...(front && { front }),
        ...(back && { back }),
      },
    });
  },
);

app.delete("/flashcards/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.flashcard.delete({ where: { id: parseInt(id) } });
});

// フラッシュカード復習（SM-2アルゴリズム）
app.post(
  "/flashcards/:id/review",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { quality: number };
  }) => {
    const { id } = params;
    const { quality } = body; // 0-5 (0=完全忘れ, 5=完璧)

    const card = await prisma.flashcard.findUnique({
      where: { id: parseInt(id) },
    });
    if (!card) return { error: "Card not found" };

    let { interval, easeFactor, reviewCount } = card;

    // SM-2アルゴリズム
    if (quality >= 3) {
      if (reviewCount === 0) {
        interval = 1;
      } else if (reviewCount === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      reviewCount++;
    } else {
      reviewCount = 0;
      interval = 1;
    }

    easeFactor = Math.max(
      1.3,
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    );

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);

    return await prisma.flashcard.update({
      where: { id: parseInt(id) },
      data: {
        interval,
        easeFactor,
        reviewCount,
        nextReview,
      },
    });
  },
);

// 今日復習すべきカード
app.get("/flashcards/due", async () => {
  const today = new Date();
  return await prisma.flashcard.findMany({
    where: {
      OR: [{ nextReview: null }, { nextReview: { lte: today } }],
    },
    include: {
      deck: true,
    },
    orderBy: { nextReview: "asc" },
  });
});

// ==================== Templates API ====================
app.get("/templates", async () => {
  return await prisma.taskTemplate.findMany({
    orderBy: [{ useCount: "desc" }, { createdAt: "desc" }],
  });
});

app.get("/templates/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.taskTemplate.findUnique({
    where: { id: parseInt(id) },
  });
});

app.post("/templates", async ({ body }: { body: any }) => {
  const { name, description, category, templateData } = body as {
    name: string;
    description?: string;
    category: string;
    templateData: any;
  };
  return await prisma.taskTemplate.create({
    data: {
      name,
      category,
      templateData,
      ...(description && { description }),
    },
  });
});

app.delete("/templates/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.taskTemplate.delete({ where: { id: parseInt(id) } });
});

// テンプレートからタスク作成
app.post("/templates/:id/apply", async ({ params }: { params: any }) => {
  const { id } = params;
  const template = await prisma.taskTemplate.findUnique({
    where: { id: parseInt(id) },
  });
  if (!template) return { error: "Template not found" };

  const data = template.templateData as any;
  const task = await prisma.task.create({
    data: {
      title: data.title || template.name,
      description: data.description,
      priority: data.priority || "medium",
      estimatedHours: data.estimatedHours,
      subject: data.subject,
    },
  });

  // サブタスクも作成
  if (data.subtasks && Array.isArray(data.subtasks)) {
    for (const st of data.subtasks) {
      await prisma.task.create({
        data: {
          title: st.title,
          parentId: task.id,
          status: "todo",
        },
      });
    }
  }

  // 使用回数を増やす
  await prisma.taskTemplate.update({
    where: { id: parseInt(id) },
    data: { useCount: { increment: 1 } },
  });

  return task;
});

// ==================== Weekly Report API ====================
app.get("/reports/weekly", async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // 今週のデータ
  const thisWeekTasks = await prisma.task.count({
    where: { status: "done", completedAt: { gte: weekAgo }, parentId: null },
  });
  const thisWeekTime = await prisma.timeEntry.findMany({
    where: { startedAt: { gte: weekAgo } },
  });
  const thisWeekHours = thisWeekTime.reduce(
    (sum: number, e: { duration: number }) => sum + e.duration,
    0,
  );

  // 先週のデータ（比較用）
  const lastWeekTasks = await prisma.task.count({
    where: {
      status: "done",
      completedAt: { gte: twoWeeksAgo, lt: weekAgo },
      parentId: null,
    },
  });
  const lastWeekTime = await prisma.timeEntry.findMany({
    where: { startedAt: { gte: twoWeeksAgo, lt: weekAgo } },
  });
  const lastWeekHours = lastWeekTime.reduce(
    (sum: number, e: { duration: number }) => sum + e.duration,
    0,
  );

  // 日別データ
  const dailyData = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const tasks = await prisma.task.count({
      where: {
        status: "done",
        completedAt: { gte: date, lt: nextDate },
        parentId: null,
      },
    });
    const time = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: date, lt: nextDate } },
    });
    const hours = time.reduce(
      (sum: number, e: { duration: number }) => sum + e.duration,
      0,
    );

    dailyData.push({
      date: date.toISOString().split("T")[0],
      tasks,
      hours: Math.round(hours * 10) / 10,
    });
  }

  // 科目別データ
  const subjectData = await prisma.task.groupBy({
    by: ["subject"],
    where: {
      subject: { not: null },
      completedAt: { gte: weekAgo },
    },
    _count: true,
  });

  return {
    period: {
      start: weekAgo.toISOString(),
      end: today.toISOString(),
    },
    summary: {
      tasksCompleted: thisWeekTasks,
      studyHours: Math.round(thisWeekHours * 10) / 10,
      tasksChange: thisWeekTasks - lastWeekTasks,
      hoursChange: Math.round((thisWeekHours - lastWeekHours) * 10) / 10,
    },
    dailyData,
    subjectBreakdown: subjectData.map(
      (s: { subject: string; _count: number }) => ({
        subject: s.subject,
        count: s._count,
      }),
    ),
  };
});

// ==================== Export API ====================
app.get("/export/tasks", async () => {
  const tasks = await prisma.task.findMany({
    where: { parentId: null },
    include: {
      subtasks: true,
      theme: true,
      taskLabels: { include: { label: true } },
      timeEntries: true,
    },
  });

  return {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    tasks: tasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      subject: t.subject,
      estimatedHours: t.estimatedHours,
      actualHours: t.actualHours,
      theme: t.theme?.name,
      labels: t.taskLabels.map((tl: any) => tl.label.name),
      subtasks: t.subtasks.map((st: any) => ({
        title: st.title,
        status: st.status,
      })),
      totalTimeHours: t.timeEntries.reduce(
        (sum: number, e: { duration: number }) => sum + e.duration,
        0,
      ),
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    })),
  };
});

// ==================== Developer Mode API ====================

// 開発者モード設定取得
app.get(
  "/developer-mode/config/:taskId",
  async ({ params }: { params: any }) => {
    const { taskId } = params;
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId: parseInt(taskId) },
      include: {
        agentSessions: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        approvalRequests: {
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    return config;
  },
);

// 開発者モード有効化
app.post(
  "/developer-mode/enable/:taskId",
  async ({ params, body }: { params: { taskId: string }; body: any }) => {
    const { taskId } = params;
    const taskIdNum = parseInt(taskId);
    const { autoApprove, maxSubtasks, priority } = body as {
      autoApprove?: boolean;
      maxSubtasks?: number;
      priority?: string;
    };

    // タスクを更新
    await prisma.task.update({
      where: { id: taskIdNum },
      data: { isDeveloperMode: true },
    });

    // 設定を作成または更新
    const config = await prisma.developerModeConfig.upsert({
      where: { taskId: taskIdNum },
      update: {
        isEnabled: true,
        ...(autoApprove !== undefined && { autoApprove }),
        ...(maxSubtasks !== undefined && { maxSubtasks }),
        ...(priority !== undefined && { priority }),
      },
      create: {
        taskId: taskIdNum,
        isEnabled: true,
        autoApprove: autoApprove ?? false,
        maxSubtasks: maxSubtasks ?? 10,
        priority: priority ?? "balanced",
      },
    });

    return config;
  },
);

// 開発者モード無効化
app.delete(
  "/developer-mode/disable/:taskId",
  async ({ params }: { params: any }) => {
    const { taskId } = params;
    const taskIdNum = parseInt(taskId);

    await prisma.task.update({
      where: { id: taskIdNum },
      data: { isDeveloperMode: false },
    });

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId: taskIdNum },
    });

    if (config) {
      await prisma.developerModeConfig.update({
        where: { taskId: taskIdNum },
        data: { isEnabled: false },
      });
    }

    return { success: true };
  },
);

// 開発者モード設定更新
app.patch(
  "/developer-mode/config/:taskId",
  async ({
    params,
    body,
  }: {
    params: { taskId: string };
    body: {
      autoApprove?: boolean;
      notifyInApp?: boolean;
      maxSubtasks?: number;
      priority?: string;
    };
  }) => {
    const { taskId } = params;
    const { autoApprove, notifyInApp, maxSubtasks, priority } = body;

    return await prisma.developerModeConfig.update({
      where: { taskId: parseInt(taskId) },
      data: {
        ...(autoApprove !== undefined && { autoApprove }),
        ...(notifyInApp !== undefined && { notifyInApp }),
        ...(maxSubtasks !== undefined && { maxSubtasks }),
        ...(priority !== undefined && { priority }),
      },
    });
  },
);

// タスク分析・サブタスク提案
app.post(
  "/developer-mode/analyze/:taskId",
  async ({ params, set }: { params: { taskId: string }; set: any }) => {
    const { taskId } = params;
    const taskIdNum = parseInt(taskId);

    // APIキーチェック
    if (!isApiKeyConfigured()) {
      set.status = 400;
      return { error: "Claude API key is not configured" };
    }

    // タスクと設定を取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
    });

    if (!task) {
      set.status = 404;
      return { error: "Task not found" };
    }

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId: taskIdNum },
    });

    if (!config || !config.isEnabled) {
      set.status = 400;
      return { error: "Developer mode is not enabled for this task" };
    }

    // セッションを作成
    const session = await prisma.agentSession.create({
      data: {
        configId: config.id,
        status: "running",
        startedAt: new Date(),
      },
    });

    try {
      // タスクを分析
      const { result, tokensUsed } = await analyzeTask(
        {
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
          estimatedHours: task.estimatedHours,
        },
        {
          maxSubtasks: config.maxSubtasks,
          priority: config.priority as
            | "aggressive"
            | "balanced"
            | "conservative",
        },
      );

      // アクションを記録
      await prisma.agentAction.create({
        data: {
          sessionId: session.id,
          actionType: "analysis",
          targetTaskId: taskIdNum,
          input: { taskTitle: task.title },
          output: result,
          tokensUsed,
          status: "success",
        },
      });

      // セッションを更新
      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          totalTokensUsed: tokensUsed,
          lastActivityAt: new Date(),
        },
      });

      // 自動承認の場合は承認リクエストを作成せず、直接サブタスクを作成
      if (config.autoApprove) {
        const createdSubtasks = [];
        for (const subtask of result.suggestedSubtasks) {
          const created = await prisma.task.create({
            data: {
              title: subtask.title,
              description: subtask.description,
              priority: subtask.priority,
              estimatedHours: subtask.estimatedHours,
              parentId: taskIdNum,
              agentGenerated: true,
            },
          });
          createdSubtasks.push(created);
        }

        await prisma.agentSession.update({
          where: { id: session.id },
          data: { status: "completed", completedAt: new Date() },
        });

        return {
          sessionId: session.id,
          analysis: result,
          autoApproved: true,
          createdSubtasks,
        };
      }

      // 承認リクエストを作成
      const approvalRequest = await prisma.approvalRequest.create({
        data: {
          configId: config.id,
          requestType: "subtask_creation",
          title: `「${task.title}」のサブタスク提案`,
          description: result.summary,
          proposedChanges: {
            subtasks: result.suggestedSubtasks,
            reasoning: result.reasoning,
            tips: result.tips,
            complexity: result.complexity,
            estimatedTotalHours: result.estimatedTotalHours,
          },
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7日後
        },
      });

      // 通知を作成
      if (config.notifyInApp) {
        await prisma.notification.create({
          data: {
            type: "approval_request",
            title: "サブタスク提案",
            message: `「${task.title}」に${result.suggestedSubtasks.length}個のサブタスクが提案されました`,
            link: `/tasks/${taskIdNum}`,
            metadata: { approvalRequestId: approvalRequest.id },
          },
        });
      }

      return {
        sessionId: session.id,
        analysis: result,
        approvalRequestId: approvalRequest.id,
        autoApproved: false,
      };
    } catch (error: any) {
      // エラー時はセッションを失敗に更新
      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: "failed",
          errorMessage: error.message,
          completedAt: new Date(),
        },
      });

      set.status = 500;
      return { error: "Analysis failed", details: error.message };
    }
  },
);

// セッション履歴取得
app.get(
  "/developer-mode/sessions/:taskId",
  async ({ params }: { params: any }) => {
    const { taskId } = params;

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId: parseInt(taskId) },
    });

    if (!config) {
      return [];
    }

    return await prisma.agentSession.findMany({
      where: { configId: config.id },
      include: {
        agentActions: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },
);

// ==================== Approvals API ====================

// 承認待ち一覧
app.get("/approvals", async ({ query }: { query: { status?: string } }) => {
  const { status } = query as { status?: string };
  return await prisma.approvalRequest.findMany({
    where: status ? { status } : { status: "pending" },
    include: {
      config: {
        include: {
          task: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
});

// 承認リクエスト詳細
app.get("/approvals/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.approvalRequest.findUnique({
    where: { id: parseInt(id) },
    include: {
      config: {
        include: {
          task: true,
        },
      },
    },
  });
});

// 承認
app.post(
  "/approvals/:id/approve",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { selectedSubtasks?: number[] };
  }) => {
    const { id } = params;
    const approvalId = parseInt(id);
    const { selectedSubtasks } = body;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        config: {
          include: { task: true },
        },
      },
    });

    if (!approval) {
      return { error: "Approval request not found" };
    }

    if (approval.status !== "pending") {
      return { error: "Approval request is not pending" };
    }

    // 承認リクエストを更新
    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: {
        status: "approved",
        approvedAt: new Date(),
      },
    });

    // リクエストタイプに応じた処理
    if (approval.requestType === "task_execution") {
      // タスク実行の承認 → 自動的にエージェント実行を開始
      const proposedChanges = approval.proposedChanges as {
        taskId: number;
        agentConfigId?: number;
        workingDirectory?: string;
      };

      const task = approval.config.task;

      // セッションを作成
      const session = await prisma.agentSession.create({
        data: {
          configId: approval.config.id,
          status: "pending",
        },
      });

      // 通知を作成
      await prisma.notification.create({
        data: {
          type: "agent_execution_started",
          title: "エージェント実行開始",
          message: `承認されたタスク「${task.title}」の自動実行を開始しました`,
          link: `/tasks/${task.id}`,
          metadata: { sessionId: session.id, taskId: task.id },
        },
      });

      // 非同期でエージェント実行を開始
      orchestrator
        .executeTask(
          {
            id: task.id,
            title: task.title,
            description: task.description,
            context: task.executionInstructions || undefined,
            workingDirectory: proposedChanges.workingDirectory,
          },
          {
            taskId: task.id,
            sessionId: session.id,
            agentConfigId: proposedChanges.agentConfigId,
            workingDirectory: proposedChanges.workingDirectory,
          },
        )
        .then(async (result) => {
          // 完了通知
          await prisma.notification.create({
            data: {
              type: "agent_execution_complete",
              title: result.success
                ? "エージェント実行完了"
                : "エージェント実行失敗",
              message: result.success
                ? `「${task.title}」の自動実行が完了しました`
                : `「${task.title}」の自動実行が失敗しました: ${result.errorMessage}`,
              link: `/tasks/${task.id}`,
              metadata: {
                sessionId: session.id,
                taskId: task.id,
                success: result.success,
              },
            },
          });

          // タスクのステータスを更新（成功時）
          if (result.success) {
            await prisma.task.update({
              where: { id: task.id },
              data: { status: "done", completedAt: new Date() },
            });
          }
        })
        .catch(async (error) => {
          console.error("Agent execution failed:", error);
          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "エージェント実行エラー",
              message: `「${task.title}」の実行中にエラーが発生しました`,
              link: `/tasks/${task.id}`,
            },
          });
        });

      return {
        success: true,
        sessionId: session.id,
        autoExecutionStarted: true,
      };
    } else if (approval.requestType === "subtask_creation") {
      // サブタスク作成の承認
      const proposedChanges = approval.proposedChanges as {
        subtasks: SubtaskProposal[];
      };

      // 選択されたサブタスクのみを作成（指定がなければ全て）
      const subtasksToCreate = selectedSubtasks
        ? proposedChanges.subtasks.filter((_, i) =>
            selectedSubtasks.includes(i),
          )
        : proposedChanges.subtasks;

      const createdSubtasks = [];
      for (const subtask of subtasksToCreate) {
        const created = await prisma.task.create({
          data: {
            title: subtask.title,
            description: subtask.description,
            priority: subtask.priority,
            estimatedHours: subtask.estimatedHours,
            parentId: approval.config.taskId,
            agentGenerated: true,
          },
        });
        createdSubtasks.push(created);
      }

      // 通知を作成
      await prisma.notification.create({
        data: {
          type: "task_completed",
          title: "サブタスク作成完了",
          message: `「${approval.config.task.title}」に${createdSubtasks.length}個のサブタスクが作成されました`,
          link: `/tasks/${approval.config.taskId}`,
        },
      });

      return { success: true, createdSubtasks };
    }

    // その他のリクエストタイプ
    await prisma.notification.create({
      data: {
        type: "approval_request",
        title: "承認完了",
        message: `リクエストが承認されました`,
        link: `/tasks/${approval.config.taskId}`,
      },
    });

    return { success: true };
  },
);

// 却下
app.post(
  "/approvals/:id/reject",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { reason?: string };
  }) => {
    const { id } = params;
    const { reason } = body as { reason?: string };

    await prisma.approvalRequest.update({
      where: { id: parseInt(id) },
      data: {
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    return { success: true };
  },
);

// 一括承認
app.post(
  "/approvals/bulk-approve",
  async ({ body }: { body: { ids: number[] } }) => {
    const { ids } = body as { ids: number[] };

    const results = [];
    for (const id of ids) {
      try {
        const approval = await prisma.approvalRequest.findUnique({
          where: { id },
          include: {
            config: {
              include: { task: true },
            },
          },
        });

        if (!approval || approval.status !== "pending") continue;

        await prisma.approvalRequest.update({
          where: { id },
          data: { status: "approved", approvedAt: new Date() },
        });

        if (approval.requestType === "task_execution") {
          // タスク実行の承認 → 自動実行開始
          const proposedChanges = approval.proposedChanges as {
            taskId: number;
            agentConfigId?: number;
            workingDirectory?: string;
          };
          const task = approval.config.task;

          const session = await prisma.agentSession.create({
            data: {
              configId: approval.config.id,
              status: "pending",
            },
          });

          // 非同期でエージェント実行を開始
          orchestrator
            .executeTask(
              {
                id: task.id,
                title: task.title,
                description: task.description,
                context: task.executionInstructions || undefined,
                workingDirectory: proposedChanges.workingDirectory,
              },
              {
                taskId: task.id,
                sessionId: session.id,
                agentConfigId: proposedChanges.agentConfigId,
                workingDirectory: proposedChanges.workingDirectory,
              },
            )
            .then(async (result) => {
              await prisma.notification.create({
                data: {
                  type: result.success
                    ? "agent_execution_complete"
                    : "agent_error",
                  title: result.success
                    ? "エージェント実行完了"
                    : "エージェント実行失敗",
                  message: result.success
                    ? `「${task.title}」の自動実行が完了しました`
                    : `「${task.title}」の自動実行が失敗しました`,
                  link: `/tasks/${task.id}`,
                },
              });
              if (result.success) {
                await prisma.task.update({
                  where: { id: task.id },
                  data: { status: "done", completedAt: new Date() },
                });
              }
            })
            .catch(console.error);

          results.push({ id, success: true, autoExecutionStarted: true });
        } else if (approval.requestType === "subtask_creation") {
          // サブタスク作成
          const proposedChanges = approval.proposedChanges as {
            subtasks: SubtaskProposal[];
          };

          for (const subtask of proposedChanges.subtasks) {
            await prisma.task.create({
              data: {
                title: subtask.title,
                description: subtask.description,
                priority: subtask.priority,
                estimatedHours: subtask.estimatedHours,
                parentId: approval.config.taskId,
                agentGenerated: true,
              },
            });
          }

          results.push({ id, success: true });
        } else {
          results.push({ id, success: true });
        }
      } catch (error) {
        results.push({ id, success: false });
      }
    }

    return { results };
  },
);

// ==================== Notifications API ====================

// 通知一覧
app.get(
  "/notifications",
  async ({ query }: { query: { unreadOnly?: string; limit?: string } }) => {
    const { unreadOnly, limit } = query as {
      unreadOnly?: string;
      limit?: string;
    };

    return await prisma.notification.findMany({
      where: unreadOnly === "true" ? { isRead: false } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit ? parseInt(limit) : 50,
    });
  },
);

// 未読通知数
app.get("/notifications/unread-count", async () => {
  const count = await prisma.notification.count({
    where: { isRead: false },
  });
  return { count };
});

// 既読にする
app.patch("/notifications/:id/read", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.notification.update({
    where: { id: parseInt(id) },
    data: { isRead: true, readAt: new Date() },
  });
});

// 全て既読にする
app.post("/notifications/mark-all-read", async () => {
  await prisma.notification.updateMany({
    where: { isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { success: true };
});

// 通知削除
app.delete(
  "/notifications/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.notification.delete({
      where: { id: parseInt(id) },
    });
  },
);

// ==================== User Settings API ====================

// 設定取得（なければ作成）
app.get("/settings", async () => {
  let settings = await prisma.userSettings.findFirst();
  if (!settings) {
    settings = await prisma.userSettings.create({
      data: {},
    });
  }
  return {
    ...settings,
    claudeApiKeyConfigured: isApiKeyConfigured(),
  };
});

// 設定更新
app.patch(
  "/settings",
  async ({ body }: { body: { developerModeDefault?: boolean } }) => {
    const { developerModeDefault } = body;

    let settings = await prisma.userSettings.findFirst();
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          developerModeDefault: developerModeDefault ?? false,
        },
      });
    } else {
      settings = await prisma.userSettings.update({
        where: { id: settings.id },
        data: {
          ...(developerModeDefault !== undefined && { developerModeDefault }),
        },
      });
    }

    return settings;
  },
);

// API設定状態の確認
app.get("/settings/api-status", async () => {
  return {
    claudeApiKeyConfigured: isApiKeyConfigured(),
  };
});

// ==================== GitHub Integration API ====================

const githubService = new GitHubService(prisma);
const orchestrator = createOrchestrator(prisma);

// GitHub CLI 状態確認
app.get("/github/status", async () => {
  const ghAvailable = await githubService.isGhAvailable();
  const authenticated = ghAvailable
    ? await githubService.isAuthenticated()
    : false;
  return { ghAvailable, authenticated };
});

// 連携設定一覧
app.get("/github/integrations", async () => {
  return await prisma.gitHubIntegration.findMany({
    include: {
      _count: { select: { pullRequests: true, issues: true } },
    },
    orderBy: { createdAt: "desc" },
  });
});

// 連携設定作成
app.post(
  "/github/integrations",
  async ({
    body,
  }: {
    body: {
      repositoryUrl: string;
      ownerName: string;
      repositoryName: string;
      syncIssues?: boolean;
      syncPullRequests?: boolean;
      autoLinkTasks?: boolean;
    };
  }) => {
    const {
      repositoryUrl,
      ownerName,
      repositoryName,
      syncIssues,
      syncPullRequests,
      autoLinkTasks,
    } = body;

    return await prisma.gitHubIntegration.create({
      data: {
        repositoryUrl,
        ownerName,
        repositoryName,
        syncIssues: syncIssues ?? true,
        syncPullRequests: syncPullRequests ?? true,
        autoLinkTasks: autoLinkTasks ?? true,
      },
    });
  },
);

// 連携設定詳細
app.get(
  "/github/integrations/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.gitHubIntegration.findUnique({
      where: { id: parseInt(id) },
      include: {
        _count: { select: { pullRequests: true, issues: true } },
      },
    });
  },
);

// 連携設定更新
app.patch(
  "/github/integrations/:id",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: {
      syncIssues?: boolean;
      syncPullRequests?: boolean;
      autoLinkTasks?: boolean;
      isActive?: boolean;
    };
  }) => {
    const { id } = params;
    const { syncIssues, syncPullRequests, autoLinkTasks, isActive } = body as {
      syncIssues?: boolean;
      syncPullRequests?: boolean;
      autoLinkTasks?: boolean;
      isActive?: boolean;
    };

    return await prisma.gitHubIntegration.update({
      where: { id: parseInt(id) },
      data: {
        ...(syncIssues !== undefined && { syncIssues }),
        ...(syncPullRequests !== undefined && { syncPullRequests }),
        ...(autoLinkTasks !== undefined && { autoLinkTasks }),
        ...(isActive !== undefined && { isActive }),
      },
    });
  },
);

// 連携設定削除
app.delete(
  "/github/integrations/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.gitHubIntegration.delete({
      where: { id: parseInt(id) },
    });
  },
);

// PR同期
app.post(
  "/github/integrations/:id/sync-prs",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    const count = await githubService.syncPullRequests(parseInt(id));
    return { syncedCount: count };
  },
);

// Issue同期
app.post(
  "/github/integrations/:id/sync-issues",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    const count = await githubService.syncIssues(parseInt(id));
    return { syncedCount: count };
  },
);

// PRリスト取得
app.get(
  "/github/integrations/:id/pull-requests",
  async ({
    params,
    query,
  }: {
    params: { id: string };
    query: { state?: string; fromGitHub?: string };
  }) => {
    const { id } = params;
    const { state, fromGitHub } = query as {
      state?: string;
      fromGitHub?: string;
    };

    if (fromGitHub === "true") {
      const integration = await prisma.gitHubIntegration.findUnique({
        where: { id: parseInt(id) },
      });
      if (!integration) return [];
      const repo = `${integration.ownerName}/${integration.repositoryName}`;
      return await githubService.getPullRequests(
        repo,
        (state as "open" | "closed" | "all") || "open",
      );
    }

    return await prisma.gitHubPullRequest.findMany({
      where: {
        integrationId: parseInt(id),
        ...(state && state !== "all" && { state }),
      },
      include: {
        _count: { select: { reviews: true, comments: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  },
);

// PR詳細取得
app.get(
  "/github/pull-requests/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        integration: true,
        reviews: { orderBy: { submittedAt: "desc" } },
        comments: { orderBy: { createdAt: "asc" } },
      },
    });
  },
);

// PR差分取得
app.get(
  "/github/pull-requests/:id/diff",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: "PR not found" };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    return await githubService.getPullRequestDiff(repo, pr.prNumber);
  },
);

// PRコメント投稿
app.post(
  "/github/pull-requests/:id/comments",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: {
      body: string;
      path?: string;
      line?: number;
    };
  }) => {
    const { id } = params;
    const { body: commentBody, path, line } = body;

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: "PR not found" };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    const comment = await githubService.createPullRequestComment(
      repo,
      pr.prNumber,
      {
        body: commentBody,
        path,
        line,
      },
    );

    // DBにコメントを保存
    await prisma.gitHubPRComment.create({
      data: {
        pullRequestId: parseInt(id),
        commentId: comment.id || 0,
        body: commentBody,
        path,
        line,
        authorLogin: "rapitas",
        isFromRapitas: true,
      },
    });

    return comment;
  },
);

// PR承認
app.post(
  "/github/pull-requests/:id/approve",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { body?: string };
  }) => {
    const { id } = params;
    const { body: reviewBody } = body as { body?: string };

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: "PR not found" };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    await githubService.approvePullRequest(repo, pr.prNumber, reviewBody);

    // 通知を作成
    await prisma.notification.create({
      data: {
        type: "pr_approved",
        title: "PR承認完了",
        message: `PR #${pr.prNumber} (${pr.title}) を承認しました`,
        link: pr.url,
      },
    });

    return { success: true };
  },
);

// PR変更リクエスト
app.post(
  "/github/pull-requests/:id/request-changes",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { body: string };
  }) => {
    const { id } = params;
    const { body: reviewBody } = body as { body: string };

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: "PR not found" };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    await githubService.requestChanges(repo, pr.prNumber, reviewBody);

    return { success: true };
  },
);

// Issueリスト取得
app.get(
  "/github/integrations/:id/issues",
  async ({
    params,
    query,
  }: {
    params: { id: string };
    query: { state?: string; fromGitHub?: string };
  }) => {
    const { id } = params;
    const { state, fromGitHub } = query as {
      state?: string;
      fromGitHub?: string;
    };

    if (fromGitHub === "true") {
      const integration = await prisma.gitHubIntegration.findUnique({
        where: { id: parseInt(id) },
      });
      if (!integration) return [];
      const repo = `${integration.ownerName}/${integration.repositoryName}`;
      return await githubService.getIssues(
        repo,
        (state as "open" | "closed" | "all") || "open",
      );
    }

    return await prisma.gitHubIssue.findMany({
      where: {
        integrationId: parseInt(id),
        ...(state && state !== "all" && { state }),
      },
      orderBy: { updatedAt: "desc" },
    });
  },
);

// Issue詳細取得
app.get(
  "/github/issues/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.gitHubIssue.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });
  },
);

// Issueコメント投稿
app.post(
  "/github/issues/:id/comments",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { body: string };
  }) => {
    const { id } = params;
    const { body: commentBody } = body as { body: string };

    const issue = await prisma.gitHubIssue.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!issue) return { error: "Issue not found" };

    const repo = `${issue.integration.ownerName}/${issue.integration.repositoryName}`;
    return await githubService.addIssueComment(
      repo,
      issue.issueNumber,
      commentBody,
    );
  },
);

// IssueからTaskを作成
app.post(
  "/github/issues/:id/create-task",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { projectId?: number; themeId?: number; priority?: string };
  }) => {
    const { id } = params;
    const { projectId, themeId, priority } = body as {
      projectId?: number;
      themeId?: number;
      priority?: string;
    };

    const issue = await prisma.gitHubIssue.findUnique({
      where: { id: parseInt(id) },
    });

    if (!issue) return { error: "Issue not found" };

    const task = await prisma.task.create({
      data: {
        title: `[GitHub] ${issue.title}`,
        description: issue.body || "",
        priority: priority || "medium",
        githubIssueId: issue.id,
        ...(projectId && { projectId }),
        ...(themeId && { themeId }),
      },
    });

    // Issue と Task を紐付け
    await prisma.gitHubIssue.update({
      where: { id: parseInt(id) },
      data: { linkedTaskId: task.id },
    });

    return task;
  },
);

// TaskからGitHub Issueを作成
app.post(
  "/tasks/:id/create-github-issue",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { integrationId: number; labels?: string[] };
  }) => {
    const { id } = params;
    const { integrationId, labels } = body as {
      integrationId: number;
      labels?: string[];
    };

    const task = await prisma.task.findUnique({
      where: { id: parseInt(id) },
    });
    if (!task) return { error: "Task not found" };

    const integration = await prisma.gitHubIntegration.findUnique({
      where: { id: integrationId },
    });
    if (!integration) return { error: "Integration not found" };

    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    const issue = await githubService.createIssue(repo, {
      title: task.title,
      body: task.description || "",
      labels,
    });

    // DBにIssueを保存
    const savedIssue = await prisma.gitHubIssue.create({
      data: {
        integrationId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: issue.labels,
        authorLogin: issue.authorLogin,
        url: issue.url,
        linkedTaskId: parseInt(id),
        lastSyncedAt: new Date(),
      },
    });

    // Task を更新
    await prisma.task.update({
      where: { id: parseInt(id) },
      data: { githubIssueId: savedIssue.id },
    });

    return savedIssue;
  },
);

// TaskにGitHub PRを紐付け
app.post(
  "/tasks/:id/link-github-pr/:prId",
  async ({ params }: { params: { id: string; prId: string } }) => {
    const { id, prId } = params;

    await prisma.gitHubPullRequest.update({
      where: { id: parseInt(prId) },
      data: { linkedTaskId: parseInt(id) },
    });

    await prisma.task.update({
      where: { id: parseInt(id) },
      data: { githubPrId: parseInt(prId) },
    });

    return { success: true };
  },
);

// Webhook受信
app.post(
  "/github/webhook",
  async ({ request, body }: { request: Request; body: {} }) => {
    const event = request.headers.get("x-github-event");
    if (!event) {
      return { error: "Missing X-GitHub-Event header" };
    }

    await githubService.handleWebhook(event, body);
    return { success: true };
  },
);

// ==================== AI Agent API ====================

// エージェント設定一覧
app.get("/agents", async () => {
  return await prisma.aIAgentConfig.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { executions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
});

// エージェント設定作成
app.post(
  "/agents",
  async ({
    body,
  }: {
    body: {
      agentType: string;
      name: string;
      endpoint?: string;
      modelId?: string;
      capabilities?: any;
      isDefault?: boolean;
    };
  }) => {
    const { agentType, name, endpoint, modelId, capabilities, isDefault } =
      body;

    // デフォルト設定の場合、既存のデフォルトを解除
    if (isDefault) {
      await prisma.aIAgentConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    return await prisma.aIAgentConfig.create({
      data: {
        agentType,
        name,
        endpoint,
        modelId,
        capabilities: capabilities || {},
        isDefault: isDefault || false,
      },
    });
  },
);

// エージェント設定更新
app.patch(
  "/agents/:id",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: {
      name?: string;
      endpoint?: string;
      modelId?: string;
      capabilities?: any;
      isDefault?: boolean;
      isActive?: boolean;
    };
  }) => {
    const { id } = params;
    const { name, endpoint, modelId, capabilities, isDefault, isActive } = body;

    if (isDefault) {
      await prisma.aIAgentConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    return await prisma.aIAgentConfig.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(endpoint !== undefined && { endpoint }),
        ...(modelId !== undefined && { modelId }),
        ...(capabilities && { capabilities }),
        ...(isDefault !== undefined && { isDefault }),
        ...(isActive !== undefined && { isActive }),
      },
    });
  },
);

// エージェント設定削除
app.delete("/agents/:id", async ({ params }: { params: { id: string } }) => {
  const { id } = params;
  return await prisma.aIAgentConfig.update({
    where: { id: parseInt(id) },
    data: { isActive: false },
  });
});

// 利用可能なエージェントタイプ一覧
app.get("/agents/types", async () => {
  const registered = agentFactory.getRegisteredAgents();
  const available = await agentFactory.getAvailableAgents();
  return {
    registered,
    available: available.map((a) => a.type),
  };
});

// タスクに対してエージェントを実行
app.post(
  "/tasks/:id/execute",
  async ({
    params,
    body,
    set,
  }: {
    params: { id: string };
    body: {
      agentConfigId?: number;
      workingDirectory?: string;
      timeout?: number;
      skipApproval?: boolean;
    };
    set: any;
  }) => {
    const { id } = params;
    const taskIdNum = parseInt(id);
    const { agentConfigId, workingDirectory, timeout, skipApproval } = body;

    // タスクを取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: { developerModeConfig: true },
    });

    if (!task) {
      set.status = 404;
      return { error: "Task not found" };
    }

    // 承認が必要かチェック
    const config = task.developerModeConfig;
    if (config && !skipApproval && config.requireApproval === "always") {
      // 承認リクエストを作成
      const approvalRequest = await prisma.approvalRequest.create({
        data: {
          configId: config.id,
          requestType: "task_execution",
          title: `「${task.title}」の自動実行`,
          description: `タスク「${task.title}」をAIエージェントで自動実行します。`,
          proposedChanges: {
            taskId: taskIdNum,
            agentConfigId,
            workingDirectory,
          },
          executionType: "code_execution",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      // 通知を作成
      await prisma.notification.create({
        data: {
          type: "approval_request",
          title: "エージェント実行承認リクエスト",
          message: `「${task.title}」の自動実行が承認待ちです`,
          link: `/approvals/${approvalRequest.id}`,
          metadata: { approvalRequestId: approvalRequest.id },
        },
      });

      return { requiresApproval: true, approvalRequestId: approvalRequest.id };
    }

    // セッションを作成
    let developerModeConfig = config;
    if (!developerModeConfig) {
      developerModeConfig = await prisma.developerModeConfig.create({
        data: {
          taskId: taskIdNum,
          isEnabled: true,
        },
      });
    }

    const session = await prisma.agentSession.create({
      data: {
        configId: developerModeConfig.id,
        status: "pending",
      },
    });

    // 通知を送信
    await prisma.notification.create({
      data: {
        type: "agent_execution_started",
        title: "エージェント実行開始",
        message: `「${task.title}」の自動実行を開始しました`,
        link: `/tasks/${taskIdNum}`,
        metadata: { sessionId: session.id, taskId: taskIdNum },
      },
    });

    // 非同期で実行
    orchestrator
      .executeTask(
        {
          id: taskIdNum,
          title: task.title,
          description: task.description,
          context: task.executionInstructions || undefined,
          workingDirectory,
        },
        {
          taskId: taskIdNum,
          sessionId: session.id,
          agentConfigId,
          workingDirectory,
          timeout,
        },
      )
      .then(async (result) => {
        // 完了通知
        await prisma.notification.create({
          data: {
            type: "agent_execution_complete",
            title: result.success
              ? "エージェント実行完了"
              : "エージェント実行失敗",
            message: result.success
              ? `「${task.title}」の自動実行が完了しました`
              : `「${task.title}」の自動実行が失敗しました: ${result.errorMessage}`,
            link: `/tasks/${taskIdNum}`,
            metadata: {
              sessionId: session.id,
              taskId: taskIdNum,
              success: result.success,
            },
          },
        });
      })
      .catch(console.error);

    return { success: true, sessionId: session.id };
  },
);

// セッション詳細取得
app.get(
  "/agents/sessions/:id",
  async ({ params }: { params: { id: string } }) => {
    return await prisma.agentSession.findUnique({
      where: { id: parseInt(params.id) },
      include: {
        agentActions: { orderBy: { createdAt: "desc" } },
        agentExecutions: {
          include: {
            agentConfig: true,
            gitCommits: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  },
);

// セッション停止
app.post(
  "/agents/sessions/:id/stop",
  async ({ params }: { params: { id: string } }) => {
    const sessionId = parseInt(params.id);

    // アクティブな実行を取得
    const executions = orchestrator.getSessionExecutions(sessionId);
    for (const execution of executions) {
      await orchestrator.stopExecution(execution.executionId);
    }

    // セッションを更新
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Manually stopped",
      },
    });

    return { success: true };
  },
);

// ==================== SSE (Server-Sent Events) API ====================

app.get(
  "/events/stream",
  ({ set }: { set: { headers: Record<string, string> } }) => {
    set.headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    };

    const clientId = realtimeService.registerClient(
      {
        write: (data: string) => {
          // Elysiaでは直接ストリームを返す必要がある
          // この実装は簡略化されている
        },
      },
      ["*"], // 全てのイベントを購読
    );

    // 接続情報を返す
    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            write: (data: string) => {
              controller.enqueue(new TextEncoder().encode(data));
            },
          };

          realtimeService.removeClient(clientId);
          const newClientId = realtimeService.registerClient(client, ["*"]);

          // クローズ時のクリーンアップ
          // Note: Elysiaでは abort イベントの処理が異なる場合がある
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  },
);

// 特定チャンネルの購読
app.get(
  "/events/subscribe/:channel",
  ({
    params,
    query,
    set,
  }: {
    params: { channel: string };
    query: { lastEventId?: string };
    set: { headers: Record<string, string> };
  }) => {
    const { channel } = params;
    const { lastEventId } = query;

    set.headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };

    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            write: (data: string) => {
              controller.enqueue(new TextEncoder().encode(data));
            },
          };

          const clientId = realtimeService.registerClient(client, [channel]);

          // 過去のイベントを送信（lastEventIdがある場合）
          if (lastEventId) {
            const history = realtimeService.getChannelHistory(channel);
            for (const event of history) {
              if (event.id && event.id > lastEventId) {
                client.write(
                  `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
                );
              }
            }
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  },
);

// SSE接続状態
app.get("/events/status", () => {
  return {
    clientCount: realtimeService.getClientCount(),
    clients: realtimeService.getClients(),
  };
});

app.listen(3001);
console.log("🚀 Rapitas backend running on http://localhost:3001");

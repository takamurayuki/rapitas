import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";

const app = new Elysia();
const prisma = new PrismaClient();

app.use(cors());

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

app.get("/themes/:id", async ({ params }) => {
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

app.post("/themes", async ({ body }) => {
  const { name, description, color, icon } = body as {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  };
  return await prisma.theme.create({
    data: {
      name,
      ...(description && { description }),
      ...(color && { color }),
      ...(icon && { icon }),
    },
  });
});

app.patch("/themes/:id", async ({ params, body }) => {
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
});

app.delete("/themes/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.theme.delete({
    where: { id: parseInt(id) },
  });
});

// デフォルトテーマ設定
app.patch("/themes/:id/set-default", async ({ params }) => {
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
});

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

app.get("/labels/:id", async ({ params }) => {
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

app.post("/labels", async ({ body }) => {
  const { name, description, color, icon } = body as {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  };
  return await prisma.label.create({
    data: {
      name,
      ...(description && { description }),
      ...(color && { color }),
      ...(icon && { icon }),
    },
  });
});

app.patch("/labels/:id", async ({ params, body }) => {
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
});

app.delete("/labels/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.label.delete({
    where: { id: parseInt(id) },
  });
});

// タスクのラベル一括更新
app.put("/tasks/:taskId/labels", async ({ params, body }) => {
  const { taskId } = params;
  const { labelIds } = body as { labelIds: number[] };
  const taskIdNum = parseInt(taskId);

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
});

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

app.get("/projects/:id", async ({ params }) => {
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

app.post("/projects", async ({ body }) => {
  const { name, description, color, icon } = body as {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  };
  return await prisma.project.create({
    data: {
      name,
      ...(description && { description }),
      ...(color && { color }),
      ...(icon && { icon }),
    },
  });
});

app.patch("/projects/:id", async ({ params, body }) => {
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
});

app.delete("/projects/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.project.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Milestones API ====================
app.get("/milestones", async ({ query }) => {
  const { projectId } = query as { projectId?: string };
  return await prisma.milestone.findMany({
    where: projectId ? { projectId: parseInt(projectId) } : undefined,
    include: {
      project: true,
      _count: { select: { tasks: true } },
    },
    orderBy: { createdAt: "asc" },
  });
});

app.get("/milestones/:id", async ({ params }) => {
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

app.post("/milestones", async ({ body }) => {
  const { name, description, dueDate, projectId } = body as {
    name: string;
    description?: string;
    dueDate?: string;
    projectId: number;
  };
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
});

app.patch("/milestones/:id", async ({ params, body }) => {
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
});

app.delete("/milestones/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.milestone.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Tasks API ====================
app.get("/tasks", async ({ query }) => {
  const { projectId, milestoneId, priority } = query as {
    projectId?: string;
    milestoneId?: string;
    priority?: string;
  };

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
});

app.get("/tasks/:id", async ({ params }) => {
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

app.post("/tasks", async ({ body }) => {
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
  } = body as {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    labels?: string[];
    labelIds?: number[];
    estimatedHours?: number;
    dueDate?: string;
    subject?: string;
    parentId?: number;
    projectId?: number;
    milestoneId?: number;
    themeId?: number;
    examGoalId?: number;
  };
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
      data: labelIds.map((labelId) => ({
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
});

app.patch("/tasks/:id", async ({ params, body }) => {
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
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
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
});

app.delete("/tasks/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.task.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Time Entries API ====================
app.get("/tasks/:id/time-entries", async ({ params }) => {
  const { id } = params;
  return await prisma.timeEntry.findMany({
    where: { taskId: parseInt(id) },
    orderBy: { startedAt: "desc" },
  });
});

app.post("/tasks/:id/time-entries", async ({ params, body }) => {
  const { id } = params;
  const { duration, note, startedAt, endedAt } = body as {
    duration: number;
    note?: string;
    startedAt: string;
    endedAt: string;
  };
  return await prisma.timeEntry.create({
    data: {
      taskId: parseInt(id),
      duration,
      note,
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
    },
  });
});

// ==================== Comments API ====================
app.get("/tasks/:id/comments", async ({ params }) => {
  const { id } = params;
  return await prisma.comment.findMany({
    where: { taskId: parseInt(id) },
    orderBy: { createdAt: "desc" },
  });
});

app.post("/tasks/:id/comments", async ({ params, body }) => {
  const { id } = params;
  const { content } = body as { content: string };
  return await prisma.comment.create({
    data: {
      taskId: parseInt(id),
      content,
    },
  });
});

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

app.get("/exam-goals/:id", async ({ params }) => {
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

app.post("/exam-goals", async ({ body }) => {
  const { name, description, examDate, targetScore, color, icon } = body as {
    name: string;
    description?: string;
    examDate: string;
    targetScore?: string;
    color?: string;
    icon?: string;
  };
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
});

app.patch("/exam-goals/:id", async ({ params, body }) => {
  const { id } = params;
  const { name, description, examDate, targetScore, color, icon, isCompleted, actualScore } = body as {
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
});

app.delete("/exam-goals/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.examGoal.delete({
    where: { id: parseInt(id) },
  });
});

// ==================== Study Streak API ====================
app.get("/study-streaks", async ({ query }) => {
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
        const diff = Math.round((streak.date.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
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

app.post("/study-streaks/record", async ({ body }) => {
  const { date, studyMinutes, tasksCompleted } = body as {
    date?: string;
    studyMinutes?: number;
    tasksCompleted?: number;
  };

  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);

  return await prisma.studyStreak.upsert({
    where: { date: targetDate },
    update: {
      ...(studyMinutes !== undefined && { studyMinutes: { increment: studyMinutes } }),
      ...(tasksCompleted !== undefined && { tasksCompleted: { increment: tasksCompleted } }),
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

app.get("/study-plans/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.studyPlan.findUnique({
    where: { id: parseInt(id) },
  });
});

app.post("/study-plans", async ({ body }) => {
  const { examGoalId, subject, prompt, generatedPlan, totalDays, startDate, endDate } = body as {
    examGoalId?: number;
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

app.patch("/study-plans/:id", async ({ params, body }) => {
  const { id } = params;
  const { isApplied } = body as { isApplied?: boolean };
  return await prisma.studyPlan.update({
    where: { id: parseInt(id) },
    data: {
      ...(isApplied !== undefined && { isApplied }),
    },
  });
});

app.delete("/study-plans/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.studyPlan.delete({
    where: { id: parseInt(id) },
  });
});

// AI学習計画生成（モックAPI - 実際のAI連携は後で追加）
app.post("/study-plans/generate", async ({ body }) => {
  const { subject, examDate, targetScore, studyHoursPerDay, currentLevel } = body as {
    subject: string;
    examDate: string;
    targetScore?: string;
    studyHoursPerDay: number;
    currentLevel: string; // beginner, intermediate, advanced
  };

  const start = new Date();
  const end = new Date(examDate);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

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
    dailyHours: studyHoursPerDay * 0.8,
  });

  phases.push({
    name: "応用力強化",
    days: phaseDays,
    tasks: [
      `${subject}の応用問題に取り組む`,
      "弱点分野を重点的に学習",
      "模擬試験を解く",
    ],
    dailyHours: studyHoursPerDay,
  });

  phases.push({
    name: "総仕上げ",
    days: totalDays - phaseDays * 2,
    tasks: [
      "過去問を時間を計って解く",
      "間違えた問題の復習",
      `${targetScore ? `目標${targetScore}達成のための最終調整` : "試験本番に向けた最終確認"}`,
    ],
    dailyHours: studyHoursPerDay * 1.2,
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
});

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
  const weekStudyHours = weekTimeEntries.reduce((sum, entry) => sum + entry.duration, 0);

  const monthTimeEntries = await prisma.timeEntry.findMany({
    where: { startedAt: { gte: monthAgo } },
  });
  const monthStudyHours = monthTimeEntries.reduce((sum, entry) => sum + entry.duration, 0);

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
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
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
app.get("/statistics/daily-study", async ({ query }) => {
  const { days } = query as { days?: string };
  const daysNum = days ? parseInt(days) : 7;

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
    dailyData[dateStr] = 0;
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
});

// 科目別学習時間
app.get("/statistics/subject-breakdown", async ({ query }) => {
  const { days } = query as { days?: string };
  const daysNum = days ? parseInt(days) : 30;

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
      const hours = task.timeEntries.reduce((sum, e) => sum + e.duration, 0);
      subjectData[task.subject] = (subjectData[task.subject] || 0) + hours;
    }
  }

  return Object.entries(subjectData)
    .map(([subject, hours]) => ({
      subject,
      hours: Math.round(hours * 10) / 10,
    }))
    .sort((a, b) => b.hours - a.hours);
});

// ==================== Achievements API ====================
// 初期実績データを作成
const ACHIEVEMENTS = [
  { key: "first_task", name: "はじめの一歩", description: "最初のタスクを完了", icon: "Star", color: "#FFD700", category: "tasks", condition: { type: "tasks_completed", count: 1 }, rarity: "common" },
  { key: "task_10", name: "やる気満々", description: "10個のタスクを完了", icon: "Zap", color: "#F59E0B", category: "tasks", condition: { type: "tasks_completed", count: 10 }, rarity: "common" },
  { key: "task_50", name: "努力家", description: "50個のタスクを完了", icon: "Award", color: "#8B5CF6", category: "tasks", condition: { type: "tasks_completed", count: 50 }, rarity: "rare" },
  { key: "task_100", name: "タスクマスター", description: "100個のタスクを完了", icon: "Crown", color: "#EC4899", category: "tasks", condition: { type: "tasks_completed", count: 100 }, rarity: "epic" },
  { key: "streak_3", name: "継続は力なり", description: "3日連続で学習", icon: "Flame", color: "#F97316", category: "streak", condition: { type: "streak", days: 3 }, rarity: "common" },
  { key: "streak_7", name: "一週間の壁突破", description: "7日連続で学習", icon: "Flame", color: "#EF4444", category: "streak", condition: { type: "streak", days: 7 }, rarity: "rare" },
  { key: "streak_30", name: "鉄人", description: "30日連続で学習", icon: "Flame", color: "#DC2626", category: "streak", condition: { type: "streak", days: 30 }, rarity: "legendary" },
  { key: "study_10h", name: "学習の第一歩", description: "累計10時間学習", icon: "Clock", color: "#3B82F6", category: "study", condition: { type: "study_hours", hours: 10 }, rarity: "common" },
  { key: "study_50h", name: "勉強熱心", description: "累計50時間学習", icon: "Clock", color: "#2563EB", category: "study", condition: { type: "study_hours", hours: 50 }, rarity: "rare" },
  { key: "study_100h", name: "学習の達人", description: "累計100時間学習", icon: "BookOpen", color: "#1D4ED8", category: "study", condition: { type: "study_hours", hours: 100 }, rarity: "epic" },
  { key: "exam_pass", name: "合格おめでとう", description: "試験目標を達成", icon: "Trophy", color: "#10B981", category: "exam", condition: { type: "exam_completed", count: 1 }, rarity: "rare" },
  { key: "early_bird", name: "早起き学習", description: "朝6時前に学習開始", icon: "Sun", color: "#FBBF24", category: "special", condition: { type: "early_study" }, rarity: "rare" },
  { key: "night_owl", name: "夜型学習者", description: "深夜0時以降に学習", icon: "Moon", color: "#6366F1", category: "special", condition: { type: "night_study" }, rarity: "rare" },
  { key: "flashcard_master", name: "暗記王", description: "100枚のフラッシュカードを復習", icon: "Brain", color: "#8B5CF6", category: "flashcard", condition: { type: "flashcard_reviews", count: 100 }, rarity: "rare" },
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

  return achievements.map((a) => ({
    ...a,
    isUnlocked: a.unlockedBy.length > 0,
    unlockedAt: a.unlockedBy[0]?.unlockedAt || null,
  }));
});

app.post("/achievements/:key/unlock", async ({ params }) => {
  const { key } = params;
  const achievement = await prisma.achievement.findUnique({ where: { key } });
  if (!achievement) return { error: "Achievement not found" };

  const existing = await prisma.userAchievement.findUnique({
    where: { achievementId: achievement.id },
  });
  if (existing) return { ...achievement, isUnlocked: true, unlockedAt: existing.unlockedAt };

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
  const streakData = await streakRes.json();
  const currentStreak = streakData.currentStreak || 0;

  // 学習時間をチェック
  const timeEntries = await prisma.timeEntry.findMany();
  const totalHours = timeEntries.reduce((sum, e) => sum + e.duration, 0);

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

app.get("/habits/:id", async ({ params }) => {
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

app.post("/habits", async ({ body }) => {
  const { name, description, icon, color, frequency, targetCount } = body as {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    frequency?: string;
    targetCount?: number;
  };
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
});

app.patch("/habits/:id", async ({ params, body }) => {
  const { id } = params;
  const { name, description, icon, color, frequency, targetCount, isActive } = body as {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    frequency?: string;
    targetCount?: number;
    isActive?: boolean;
  };
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
});

app.delete("/habits/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.habit.delete({ where: { id: parseInt(id) } });
});

app.post("/habits/:id/log", async ({ params, body }) => {
  const { id } = params;
  const { date, note } = body as { date?: string; note?: string };

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
});

// ==================== Resources API ====================
app.get("/tasks/:taskId/resources", async ({ params }) => {
  const { taskId } = params;
  return await prisma.resource.findMany({
    where: { taskId: parseInt(taskId) },
    orderBy: { createdAt: "desc" },
  });
});

app.post("/resources", async ({ body }) => {
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

app.delete("/resources/:id", async ({ params }) => {
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

app.get("/flashcard-decks/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.flashcardDeck.findUnique({
    where: { id: parseInt(id) },
    include: {
      cards: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
});

app.post("/flashcard-decks", async ({ body }) => {
  const { name, description, color, taskId } = body as {
    name: string;
    description?: string;
    color?: string;
    taskId?: number;
  };
  return await prisma.flashcardDeck.create({
    data: {
      name,
      ...(description && { description }),
      ...(color && { color }),
      ...(taskId && { taskId }),
    },
  });
});

app.delete("/flashcard-decks/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.flashcardDeck.delete({ where: { id: parseInt(id) } });
});

app.post("/flashcard-decks/:deckId/cards", async ({ params, body }) => {
  const { deckId } = params;
  const { front, back } = body as { front: string; back: string };
  return await prisma.flashcard.create({
    data: {
      deckId: parseInt(deckId),
      front,
      back,
    },
  });
});

app.patch("/flashcards/:id", async ({ params, body }) => {
  const { id } = params;
  const { front, back } = body as { front?: string; back?: string };
  return await prisma.flashcard.update({
    where: { id: parseInt(id) },
    data: {
      ...(front && { front }),
      ...(back && { back }),
    },
  });
});

app.delete("/flashcards/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.flashcard.delete({ where: { id: parseInt(id) } });
});

// フラッシュカード復習（SM-2アルゴリズム）
app.post("/flashcards/:id/review", async ({ params, body }) => {
  const { id } = params;
  const { quality } = body as { quality: number }; // 0-5 (0=完全忘れ, 5=完璧)

  const card = await prisma.flashcard.findUnique({ where: { id: parseInt(id) } });
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

  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

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
});

// 今日復習すべきカード
app.get("/flashcards/due", async () => {
  const today = new Date();
  return await prisma.flashcard.findMany({
    where: {
      OR: [
        { nextReview: null },
        { nextReview: { lte: today } },
      ],
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

app.get("/templates/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.taskTemplate.findUnique({
    where: { id: parseInt(id) },
  });
});

app.post("/templates", async ({ body }) => {
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

app.delete("/templates/:id", async ({ params }) => {
  const { id } = params;
  return await prisma.taskTemplate.delete({ where: { id: parseInt(id) } });
});

// テンプレートからタスク作成
app.post("/templates/:id/apply", async ({ params }) => {
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
  const thisWeekHours = thisWeekTime.reduce((sum, e) => sum + e.duration, 0);

  // 先週のデータ（比較用）
  const lastWeekTasks = await prisma.task.count({
    where: { status: "done", completedAt: { gte: twoWeeksAgo, lt: weekAgo }, parentId: null },
  });
  const lastWeekTime = await prisma.timeEntry.findMany({
    where: { startedAt: { gte: twoWeeksAgo, lt: weekAgo } },
  });
  const lastWeekHours = lastWeekTime.reduce((sum, e) => sum + e.duration, 0);

  // 日別データ
  const dailyData = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const tasks = await prisma.task.count({
      where: { status: "done", completedAt: { gte: date, lt: nextDate }, parentId: null },
    });
    const time = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: date, lt: nextDate } },
    });
    const hours = time.reduce((sum, e) => sum + e.duration, 0);

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
    subjectBreakdown: subjectData.map((s) => ({
      subject: s.subject,
      count: s._count,
    })),
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
    tasks: tasks.map((t) => ({
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
      labels: t.taskLabels.map((tl) => tl.label.name),
      subtasks: t.subtasks.map((st) => ({
        title: st.title,
        status: st.status,
      })),
      totalTimeHours: t.timeEntries.reduce((sum, e) => sum + e.duration, 0),
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    })),
  };
});

app.listen(3001);
console.log("🚀 Rapitas backend running on http://localhost:3001");

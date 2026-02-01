// Tauri/SQLite initialization - must be imported first
import {
  initTauriEnvironment,
  initializeDatabase,
  isTauriBuild,
  getDatabaseUrl,
} from "./utils/tauri-init";

// グローバルエラーハンドラー - サーバークラッシュ防止
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error);
  console.error("[FATAL] Stack:", error.stack);
  // サーバーを停止しない - ログのみ
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise);
  console.error("[FATAL] Reason:", reason);
  // サーバーを停止しない - ログのみ
});

import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import {
  analyzeTask,
  generateExecutionInstructions,
  generateOptimizedPrompt,
  formatPromptForAgent,
  isApiKeyConfigured,
  isApiKeyConfiguredAsync,
  generateBranchName,
  type SubtaskProposal,
  type OptimizedPromptResult,
} from "./services/claude-agent";
import { GitHubService } from "./services/github-service";
import { agentFactory } from "./services/agents/agent-factory";
import { createOrchestrator } from "./services/agents/agent-orchestrator";
import { realtimeService } from "./services/realtime-service";
import { encrypt, decrypt, maskApiKey } from "./utils/encryption";
import {
  SSEStreamController,
  createSSEHeaders,
  getUserFriendlyErrorMessage,
  type RetryConfig,
} from "./services/sse-utils";

const app = new Elysia();

// データベースURLを明示的に指定してPrismaClientを初期化
const dbUrl = getDatabaseUrl();
console.log(`[DB] Connecting to: ${isTauriBuild ? "SQLite" : "PostgreSQL"}`);
console.log(`[DB] URL: ${dbUrl.substring(0, 50)}...`);

const prisma = new PrismaClient({
  datasourceUrl: dbUrl,
});

// ラベルを配列として取得するヘルパー関数（SQLite/PostgreSQL両対応）
function getLabelsArray(labels: any): string[] {
  if (!labels) return [];

  // 文字列の場合（SQLite JSON）
  if (typeof labels === "string") {
    try {
      const parsed = JSON.parse(labels);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // 配列の場合
  if (Array.isArray(labels)) {
    // オブジェクトの配列（PostgreSQLリレーション）
    if (labels.length > 0 && typeof labels[0] === "object" && labels[0]?.name) {
      return labels.map((l: any) => l.name);
    }
    // 文字列の配列
    return labels.filter((l: any) => typeof l === "string");
  }

  return [];
}

// JSONフィールドをSQLite互換の文字列に変換するヘルパー関数
function toJsonString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// SQLiteから読み取ったJSON文字列をオブジェクトに変換するヘルパー関数
function fromJsonString<T = any>(value: any): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  // すでにオブジェクトの場合はそのまま返す（PostgreSQL互換）
  return value as T;
}

app.use(cors());

// エラーハンドリング
app.onError(
  ({
    code,
    error,
    set,
  }: {
    code: string;
    error: Error;
    set: { status: number };
  }) => {
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
  },
);

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

app.get("/themes/:id", async ({ params }: { params: { id: string } }) => {
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
    const {
      name,
      description,
      color,
      icon,
      isDevelopment,
      repositoryUrl,
      workingDirectory,
      defaultBranch,
    } = body;
    return await prisma.theme.create({
      data: {
        name,
        ...(description && { description }),
        ...(color && { color }),
        ...(icon && { icon }),
        ...(isDevelopment !== undefined && { isDevelopment }),
        ...(repositoryUrl && { repositoryUrl }),
        ...(workingDirectory && { workingDirectory }),
        ...(defaultBranch && { defaultBranch }),
      },
    });
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      color: t.Optional(t.String()),
      icon: t.Optional(t.String()),
      isDevelopment: t.Optional(t.Boolean()),
      repositoryUrl: t.Optional(t.String()),
      workingDirectory: t.Optional(t.String()),
      defaultBranch: t.Optional(t.String()),
    }),
  },
);

app.patch(
  "/themes/:id",
  async ({ params, body, set }: { params: any; body: any; set: any }) => {
    const { id } = params;
    const themeId = parseInt(id);

    if (isNaN(themeId)) {
      set.status = 400;
      return { error: "無効なIDです" };
    }

    const {
      name,
      description,
      color,
      icon,
      isDevelopment,
      repositoryUrl,
      workingDirectory,
      defaultBranch,
    } = body;

    try {
      // テーマが存在するか確認
      const existingTheme = await prisma.theme.findUnique({
        where: { id: themeId },
      });

      if (!existingTheme) {
        set.status = 404;
        return { error: "テーマが見つかりません" };
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (color !== undefined) updateData.color = color;
      if (icon !== undefined) updateData.icon = icon;
      if (isDevelopment !== undefined) updateData.isDevelopment = isDevelopment;
      if (repositoryUrl !== undefined) updateData.repositoryUrl = repositoryUrl;
      if (workingDirectory !== undefined)
        updateData.workingDirectory = workingDirectory;
      if (defaultBranch !== undefined) updateData.defaultBranch = defaultBranch;

      const updatedTheme = await prisma.theme.update({
        where: { id: themeId },
        data: updateData,
      });

      return updatedTheme;
    } catch (error: any) {
      console.error("Theme update error:", error);
      set.status = 500;
      return { error: error.message || "テーマの更新に失敗しました" };
    }
  },
  {
    body: t.Object({
      name: t.Optional(t.String()),
      description: t.Optional(t.String()),
      color: t.Optional(t.String()),
      icon: t.Optional(t.String()),
      isDevelopment: t.Optional(t.Boolean()),
      repositoryUrl: t.Optional(t.String()),
      workingDirectory: t.Optional(t.String()),
      defaultBranch: t.Optional(t.String()),
    }),
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
      isDeveloperMode,
      isAiTaskAnalysis,
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
        ...(isDeveloperMode !== undefined && { isDeveloperMode }),
        ...(isAiTaskAnalysis !== undefined && { isAiTaskAnalysis }),
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
      isDeveloperMode: t.Optional(t.Boolean()),
      isAiTaskAnalysis: t.Optional(t.Boolean()),
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
app.get("/templates", async ({ query }: { query: any }) => {
  const { category, search, themeId } = query as {
    category?: string;
    search?: string;
    themeId?: string;
  };

  const where: any = {};

  if (category) {
    where.category = category;
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
    ];
  }

  if (themeId) {
    where.themeId = parseInt(themeId);
  }

  return await prisma.taskTemplate.findMany({
    where,
    include: {
      theme: {
        select: {
          id: true,
          name: true,
          color: true,
          icon: true,
        },
      },
    },
    orderBy: [{ useCount: "desc" }, { createdAt: "desc" }],
  });
});

// カテゴリ一覧を取得
app.get("/templates/categories", async () => {
  const templates = await prisma.taskTemplate.findMany({
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return templates.map((t: { category: string }) => t.category);
});

app.get("/templates/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.taskTemplate.findUnique({
    where: { id: parseInt(id) },
    include: {
      theme: {
        select: {
          id: true,
          name: true,
          color: true,
          icon: true,
        },
      },
    },
  });
});

app.post("/templates", async ({ body }: { body: any }) => {
  const { name, description, category, templateData, themeId } = body as {
    name: string;
    description?: string;
    category: string;
    templateData: any;
    themeId?: number;
  };
  return await prisma.taskTemplate.create({
    data: {
      name,
      category,
      templateData,
      ...(description && { description }),
      ...(themeId && { themeId }),
    },
    include: {
      theme: {
        select: {
          id: true,
          name: true,
          color: true,
          icon: true,
        },
      },
    },
  });
});

// タスクからテンプレートを作成
app.post(
  "/templates/from-task/:taskId",
  async ({ params, body }: { params: any; body: any }) => {
    const { taskId } = params;
    const { name, description, category } = body as {
      name: string;
      description?: string;
      category: string;
    };

    // タスクを取得（サブタスク含む）
    const task = await prisma.task.findUnique({
      where: { id: parseInt(taskId) },
      include: {
        subtasks: {
          select: {
            title: true,
            description: true,
            estimatedHours: true,
          },
          orderBy: { id: "asc" },
        },
        taskLabels: {
          include: {
            label: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!task) {
      return { error: "Task not found" };
    }

    // テンプレートデータを構築
    const templateData = {
      title: task.title,
      description: task.description,
      priority: task.priority,
      estimatedHours: task.estimatedHours,
      labels:
        task.taskLabels
          ?.map((tl: { label: { name: string } }) => tl.label?.name)
          .filter(Boolean) || [],
      subtasks: task.subtasks.map(
        (st: {
          title: string;
          description?: string;
          estimatedHours?: number;
        }) => ({
          title: st.title,
          description: st.description,
          estimatedHours: st.estimatedHours,
        }),
      ),
    };

    // テンプレートを作成（タスクのテーマも保存）
    const template = await prisma.taskTemplate.create({
      data: {
        name,
        category,
        templateData: toJsonString(templateData) ?? "{}",
        ...(description && { description }),
        ...(task.themeId && { themeId: task.themeId }),
      },
      include: {
        theme: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
          },
        },
      },
    });

    return template;
  },
);

app.delete("/templates/:id", async ({ params }: { params: any }) => {
  const { id } = params;
  return await prisma.taskTemplate.delete({ where: { id: parseInt(id) } });
});

// テンプレートからタスク作成
app.post(
  "/templates/:id/apply",
  async ({ params, body }: { params: any; body: any }) => {
    const { id } = params;
    const {
      themeId,
      projectId,
      milestoneId,
      title: customTitle,
      dueDate,
    } = (body || {}) as {
      themeId?: number;
      projectId?: number;
      milestoneId?: number;
      title?: string;
      dueDate?: string;
    };

    const template = await prisma.taskTemplate.findUnique({
      where: { id: parseInt(id) },
    });
    if (!template) return { error: "Template not found" };

    const data = fromJsonString<any>(template.templateData);
    const task = await prisma.task.create({
      data: {
        title: customTitle || data.title || template.name,
        description: data.description,
        priority: data.priority || "medium",
        estimatedHours: data.estimatedHours,
        subject: data.subject,
        ...(themeId && { themeId }),
        ...(projectId && { projectId }),
        ...(milestoneId && { milestoneId }),
        ...(dueDate && { dueDate: new Date(dueDate) }),
      },
    });

    // サブタスクも作成（説明とestimatedHoursを含む）
    if (data.subtasks && Array.isArray(data.subtasks)) {
      for (const st of data.subtasks) {
        await prisma.task.create({
          data: {
            title: st.title,
            description: st.description,
            estimatedHours: st.estimatedHours,
            parentId: task.id,
            status: "todo",
          },
        });
      }
    }

    // ラベルを取得して紐付け（テンプレートに保存されたラベル名から）
    if (data.labels && Array.isArray(data.labels) && data.labels.length > 0) {
      const labels = await prisma.label.findMany({
        where: {
          name: { in: data.labels },
        },
      });

      if (labels.length > 0) {
        await prisma.taskLabel.createMany({
          data: labels.map((label: { id: number }) => ({
            taskId: task.id,
            labelId: label.id,
          })),
        });
      }
    }

    // 使用回数を増やす
    await prisma.taskTemplate.update({
      where: { id: parseInt(id) },
      data: { useCount: { increment: 1 } },
    });

    // 作成したタスクをリレーション付きで返す
    const createdTask = await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        subtasks: true,
        taskLabels: {
          include: { label: true },
        },
        theme: true,
        project: true,
        milestone: true,
      },
    });

    return createdTask;
  },
);

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

    // APIキーチェック（DB優先、環境変数フォールバック）
    const apiKeyConfigured = await isApiKeyConfiguredAsync();
    if (!apiKeyConfigured) {
      set.status = 400;
      return {
        error:
          "Claude APIキーが設定されていません。設定ページでAPIキーを登録してください。",
      };
    }

    // タスクと設定を取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
    });

    if (!task) {
      set.status = 404;
      return { error: "タスクが見つかりません" };
    }

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId: taskIdNum },
    });

    if (!config || !config.isEnabled) {
      set.status = 400;
      return {
        error:
          "このタスクでは開発者モードが有効になっていません。先に開発者モードを有効にしてください。",
      };
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
          input: toJsonString({ taskTitle: task.title }),
          output: toJsonString(result),
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
          proposedChanges: toJsonString({
            subtasks: result.suggestedSubtasks,
            reasoning: result.reasoning,
            tips: result.tips,
            complexity: result.complexity,
            estimatedTotalHours: result.estimatedTotalHours,
          }),
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
            metadata: toJsonString({ approvalRequestId: approvalRequest.id }),
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

// プロンプト最適化API
app.post(
  "/developer-mode/optimize-prompt/:taskId",
  async ({
    params,
    body,
    set,
  }: {
    params: { taskId: string };
    body: any;
    set: any;
  }) => {
    const { taskId } = params;
    const taskIdNum = parseInt(taskId);
    const { clarificationAnswers, savePrompt } = body || {};

    // APIキーチェック
    const apiKeyConfigured = await isApiKeyConfiguredAsync();
    if (!apiKeyConfigured) {
      set.status = 400;
      return {
        error:
          "Claude APIキーが設定されていません。設定ページでAPIキーを登録してください。",
      };
    }

    // タスクとサブタスクを取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        subtasks: true,
      },
    });

    if (!task) {
      set.status = 404;
      return { error: "タスクが見つかりません" };
    }

    // 最新のAI分析結果を取得（存在する場合）
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId: taskIdNum },
      include: {
        agentSessions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            agentActions: {
              where: { actionType: "analysis", status: "success" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    let analysisResult = null;
    if (config?.agentSessions?.[0]?.agentActions?.[0]?.output) {
      analysisResult = fromJsonString(
        config.agentSessions[0].agentActions[0].output,
      );
    }

    try {
      // プロンプト最適化を実行
      const { result, tokensUsed } = await generateOptimizedPrompt(
        {
          title: task.title,
          description: task.description,
          priority: task.priority,
          labels: getLabelsArray(task.labels),
        },
        analysisResult,
        clarificationAnswers,
      );

      // トークン使用量を記録（セッションが存在する場合）
      if (config?.agentSessions?.[0]) {
        await prisma.agentSession.update({
          where: { id: config.agentSessions[0].id },
          data: {
            totalTokensUsed: {
              increment: tokensUsed,
            },
            lastActivityAt: new Date(),
          },
        });
      }

      // 質問がなく、保存オプションが有効な場合はプロンプトを保存
      let savedPromptId = null;
      if (
        savePrompt &&
        (!result.clarificationQuestions ||
          result.clarificationQuestions.length === 0)
      ) {
        const savedPrompt = await prisma.taskPrompt.create({
          data: {
            taskId: taskIdNum,
            name: `${task.title} - 最適化プロンプト`,
            originalDescription: task.description,
            optimizedPrompt: result.optimizedPrompt,
            structuredSections: toJsonString(result.structuredSections),
            qualityScore: result.promptQuality.score,
            isActive: true,
          },
        });
        savedPromptId = savedPrompt.id;
      }

      const questionsCount = result.clarificationQuestions?.length || 0;
      const hasQuestions = questionsCount > 0;

      return {
        optimizedPrompt: result.optimizedPrompt,
        structuredSections: result.structuredSections,
        clarificationQuestions: result.clarificationQuestions || [],
        promptQuality: result.promptQuality,
        tokensUsed,
        hasQuestions,
        savedPromptId,
        taskInfo: {
          id: task.id,
          title: task.title,
          hasSubtasks: task.subtasks.length > 0,
          subtaskCount: task.subtasks.length,
        },
      };
    } catch (error: any) {
      console.error("Prompt optimization error:", error);
      set.status = 500;
      return {
        error: "プロンプト最適化に失敗しました",
        details: error.message,
      };
    }
  },
);

// 最適化プロンプトをエージェント実行用フォーマットに変換
app.post(
  "/developer-mode/format-prompt/:taskId",
  async ({
    params,
    body,
    set,
  }: {
    params: { taskId: string };
    body: any;
    set: any;
  }) => {
    const { taskId } = params;
    const taskIdNum = parseInt(taskId);
    const { optimizedResult } = body;

    if (!optimizedResult) {
      set.status = 400;
      return { error: "optimizedResult is required" };
    }

    // タスクを取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
    });

    if (!task) {
      set.status = 404;
      return { error: "タスクが見つかりません" };
    }

    const formattedPrompt = formatPromptForAgent(optimizedResult, task.title);

    return {
      formattedPrompt,
    };
  },
  {
    body: t.Object({
      optimizedResult: t.Object({
        optimizedPrompt: t.String(),
        structuredSections: t.Object({
          objective: t.String(),
          context: t.String(),
          requirements: t.Array(t.String()),
          constraints: t.Array(t.String()),
          deliverables: t.Array(t.String()),
          technicalDetails: t.Optional(t.String()),
        }),
        promptQuality: t.Object({
          score: t.Number(),
          issues: t.Array(t.String()),
          suggestions: t.Array(t.String()),
        }),
      }),
    }),
  },
);

// ブランチ名生成API
app.post(
  "/developer-mode/generate-branch-name",
  async ({
    body,
    set,
  }: {
    body: { title: string; description?: string };
    set: any;
  }) => {
    const { title, description } = body;

    if (!title) {
      set.status = 400;
      return { error: "タスクタイトルは必須です" };
    }

    // APIキーチェック
    const apiKeyConfigured = await isApiKeyConfiguredAsync();
    if (!apiKeyConfigured) {
      set.status = 400;
      return {
        error:
          "Claude APIキーが設定されていません。設定ページでAPIキーを登録してください。",
      };
    }

    try {
      const result = await generateBranchName(title, description);
      return result;
    } catch (error: any) {
      console.error("Branch name generation error:", error);
      set.status = 500;
      return {
        error: "ブランチ名の生成に失敗しました",
        details: error.message,
      };
    }
  },
  {
    body: t.Object({
      title: t.String(),
      description: t.Optional(t.String()),
    }),
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

// ==================== Prompts API ====================

// タスクのプロンプト一覧取得
app.get(
  "/tasks/:id/prompts",
  async ({ params }: { params: { id: string } }) => {
    const taskIdNum = parseInt(params.id);

    // タスクと子タスクを取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        subtasks: {
          select: { id: true, title: true },
        },
      },
    });

    if (!task) {
      return { error: "タスクが見つかりません" };
    }

    type SubtaskInfo = {
      id: number;
      title: string;
    };

    // 親タスクとサブタスクのプロンプトを取得
    const taskIds = [
      taskIdNum,
      ...task.subtasks.map((st: SubtaskInfo) => st.id),
    ];
    const prompts = await prisma.taskPrompt.findMany({
      where: { taskId: { in: taskIds } },
      orderBy: { createdAt: "desc" },
    });

    return {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        hasSubtasks: task.subtasks.length > 0,
      },
      subtasks: task.subtasks as SubtaskInfo[],
      prompts,
    };
  },
);

// プロンプト作成
app.post(
  "/tasks/:id/prompts",
  async ({
    params,
    body,
    set,
  }: {
    params: { id: string };
    body: any;
    set: any;
  }) => {
    const taskIdNum = parseInt(params.id);
    const {
      name,
      optimizedPrompt,
      structuredSections,
      qualityScore,
      originalDescription,
    } = body;

    if (!optimizedPrompt) {
      set.status = 400;
      return { error: "optimizedPromptは必須です" };
    }

    const prompt = await prisma.taskPrompt.create({
      data: {
        taskId: taskIdNum,
        name,
        optimizedPrompt,
        structuredSections,
        qualityScore,
        originalDescription,
        isActive: true,
      },
    });

    return prompt;
  },
);

// プロンプト更新
app.patch(
  "/prompts/:id",
  async ({
    params,
    body,
    set,
  }: {
    params: { id: string };
    body: any;
    set: any;
  }) => {
    const promptId = parseInt(params.id);
    const { name, optimizedPrompt, isActive } = body;

    const existing = await prisma.taskPrompt.findUnique({
      where: { id: promptId },
    });

    if (!existing) {
      set.status = 404;
      return { error: "プロンプトが見つかりません" };
    }

    const updated = await prisma.taskPrompt.update({
      where: { id: promptId },
      data: {
        ...(name !== undefined && { name }),
        ...(optimizedPrompt !== undefined && { optimizedPrompt }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return updated;
  },
);

// プロンプト削除
app.delete(
  "/prompts/:id",
  async ({ params, set }: { params: { id: string }; set: any }) => {
    const promptId = parseInt(params.id);

    const existing = await prisma.taskPrompt.findUnique({
      where: { id: promptId },
    });

    if (!existing) {
      set.status = 404;
      return { error: "プロンプトが見つかりません" };
    }

    await prisma.taskPrompt.delete({
      where: { id: promptId },
    });

    return { success: true };
  },
);

// サブタスクを含む全プロンプト生成（一括最適化）
app.post(
  "/tasks/:id/prompts/generate-all",
  async ({ params, set }: { params: { id: string }; set: any }) => {
    const taskIdNum = parseInt(params.id);

    // APIキーチェック
    const apiKeyConfigured = await isApiKeyConfiguredAsync();
    if (!apiKeyConfigured) {
      set.status = 400;
      return {
        error:
          "Claude APIキーが設定されていません。設定ページでAPIキーを登録してください。",
      };
    }

    // タスクとサブタスクを取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        subtasks: true,
      },
    });

    if (!task) {
      set.status = 404;
      return { error: "タスクが見つかりません" };
    }

    const results: Array<{
      taskId: number;
      title: string;
      isSubtask: boolean;
      success: boolean;
      prompt?: any;
      error?: string;
    }> = [];

    // サブタスクがない場合は親タスクのみ最適化
    if (task.subtasks.length === 0) {
      try {
        const { result, tokensUsed } = await generateOptimizedPrompt({
          title: task.title,
          description: task.description,
          priority: task.priority,
          labels: getLabelsArray(task.labels),
        });

        // プロンプトを保存
        const savedPrompt = await prisma.taskPrompt.create({
          data: {
            taskId: task.id,
            name: `${task.title} - 最適化プロンプト`,
            originalDescription: task.description,
            optimizedPrompt: result.optimizedPrompt,
            structuredSections: toJsonString(result.structuredSections),
            qualityScore: result.promptQuality.score,
            isActive: true,
          },
        });

        results.push({
          taskId: task.id,
          title: task.title,
          isSubtask: false,
          success: true,
          prompt: savedPrompt,
        });
      } catch (error: any) {
        results.push({
          taskId: task.id,
          title: task.title,
          isSubtask: false,
          success: false,
          error: error.message,
        });
      }
    } else {
      // サブタスクがある場合は各サブタスクごとに最適化
      for (const subtask of task.subtasks) {
        try {
          const { result, tokensUsed } = await generateOptimizedPrompt({
            title: subtask.title,
            description: subtask.description,
            priority: subtask.priority,
            labels: getLabelsArray(subtask.labels),
          });

          // プロンプトを保存
          const savedPrompt = await prisma.taskPrompt.create({
            data: {
              taskId: subtask.id,
              name: `${subtask.title} - 最適化プロンプト`,
              originalDescription: subtask.description,
              optimizedPrompt: result.optimizedPrompt,
              structuredSections: toJsonString(result.structuredSections),
              qualityScore: result.promptQuality.score,
              isActive: true,
            },
          });

          results.push({
            taskId: subtask.id,
            title: subtask.title,
            isSubtask: true,
            success: true,
            prompt: savedPrompt,
          });
        } catch (error: any) {
          results.push({
            taskId: subtask.id,
            title: subtask.title,
            isSubtask: true,
            success: false,
            error: error.message,
          });
        }
      }
    }

    return {
      taskId: task.id,
      taskTitle: task.title,
      hasSubtasks: task.subtasks.length > 0,
      subtaskCount: task.subtasks.length,
      results,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    };
  },
);

// ==================== Task Dependency Analysis API ====================

// タスクの依存度分析（ファイル共有ベース）
app.get(
  "/tasks/:id/dependency-analysis",
  async ({ params }: { params: { id: string } }) => {
    const taskIdNum = parseInt(params.id);

    // 親タスクとサブタスクを取得
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        subtasks: {
          include: {
            prompts: true,
          },
        },
        prompts: true,
      },
    });

    if (!task) {
      return { error: "タスクが見つかりません" };
    }

    // プロンプトからファイルパスを抽出する関数
    const extractFilePaths = (text: string | null): string[] => {
      if (!text) return [];

      // 各種ファイルパスパターンを検出
      const patterns = [
        // Unix/Mac パス
        /(?:^|\s|["'`])([\/][\w\-\.\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
        // Windows パス
        /(?:^|\s|["'`])([A-Za-z]:[\\\/][\w\-\.\\\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
        // 相対パス
        /(?:^|\s|["'`])(\.{0,2}[\/\\][\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
        // src/components/... 形式
        /(?:^|\s|["'`])((?:src|lib|app|components|pages|features?|services?|utils?|hooks?|types?|api|routes?)[\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
      ];

      const files = new Set<string>();
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const filePath = match[1]
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .toLowerCase();

          // 拡張子のあるファイルのみ
          if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
            files.add(filePath);
          }
        }
      }
      return Array.from(files);
    };

    // ファイル名のみを取得（ディレクトリを無視）
    const getFileName = (path: string): string => {
      const parts = path.split("/");
      return parts[parts.length - 1];
    };

    // 各サブタスクのファイル情報を収集
    type SubtaskFileInfo = {
      id: number;
      title: string;
      files: string[];
      fileNames: string[];
    };

    const subtaskFiles: SubtaskFileInfo[] = [];

    // サブタスクがない場合は親タスクのプロンプトを分析
    if (task.subtasks.length === 0) {
      const parentFiles: string[] = [];
      for (const prompt of task.prompts) {
        parentFiles.push(...extractFilePaths(prompt.optimizedPrompt));
        parentFiles.push(...extractFilePaths(prompt.originalDescription));
      }
      // 説明からも抽出
      parentFiles.push(...extractFilePaths(task.description));

      const uniqueFiles = Array.from(new Set(parentFiles));
      subtaskFiles.push({
        id: task.id,
        title: task.title,
        files: uniqueFiles,
        fileNames: uniqueFiles.map(getFileName),
      });
    } else {
      // サブタスクごとにファイルを収集
      for (const subtask of task.subtasks) {
        const files: string[] = [];

        for (const prompt of subtask.prompts) {
          files.push(...extractFilePaths(prompt.optimizedPrompt));
          files.push(...extractFilePaths(prompt.originalDescription));
        }
        // 説明からも抽出
        files.push(...extractFilePaths(subtask.description));

        const uniqueFiles = Array.from(new Set(files));
        subtaskFiles.push({
          id: subtask.id,
          title: subtask.title,
          files: uniqueFiles,
          fileNames: uniqueFiles.map(getFileName),
        });
      }
    }

    // 依存度を計算（共有ファイル数に基づく）
    type DependencyInfo = {
      taskId: number;
      title: string;
      files: string[];
      dependencies: Array<{
        taskId: number;
        title: string;
        sharedFiles: string[];
        dependencyScore: number; // 0-100
      }>;
      independenceScore: number; // 独立性スコア 0-100
      canRunParallel: boolean;
    };

    const dependencyAnalysis: DependencyInfo[] = [];

    for (const current of subtaskFiles) {
      const dependencies: DependencyInfo["dependencies"] = [];

      for (const other of subtaskFiles) {
        if (current.id === other.id) continue;

        // 共有ファイルを検出（ファイル名ベース）
        const sharedFiles = current.fileNames.filter((fn) =>
          other.fileNames.includes(fn),
        );

        if (sharedFiles.length > 0) {
          // 依存度スコア: 共有ファイル数 / 現在タスクのファイル数 * 100
          const score =
            current.files.length > 0
              ? Math.round((sharedFiles.length / current.files.length) * 100)
              : 0;

          dependencies.push({
            taskId: other.id,
            title: other.title,
            sharedFiles,
            dependencyScore: score,
          });
        }
      }

      // 独立性スコア: 他タスクと共有しているファイルがない場合は100
      const totalSharedFiles = new Set(
        dependencies.flatMap((d) => d.sharedFiles),
      ).size;
      const independenceScore =
        current.files.length > 0
          ? Math.round(
              ((current.files.length - totalSharedFiles) /
                current.files.length) *
                100,
            )
          : 100;

      dependencyAnalysis.push({
        taskId: current.id,
        title: current.title,
        files: current.files,
        dependencies: dependencies.sort(
          (a, b) => b.dependencyScore - a.dependencyScore,
        ),
        independenceScore,
        canRunParallel: dependencies.length === 0 || independenceScore >= 70,
      });
    }

    // ツリー構造を生成
    type TreeNode = {
      id: number;
      title: string;
      files: string[];
      independenceScore: number;
      canRunParallel: boolean;
      level: number;
      children: TreeNode[];
      dependsOn: Array<{ id: number; title: string; sharedFiles: string[] }>;
    };

    // 依存度でソート（独立性の高い順）
    const sortedTasks = [...dependencyAnalysis].sort(
      (a, b) => b.independenceScore - a.independenceScore,
    );

    // ツリーを構築
    const buildTree = (): TreeNode[] => {
      const nodes: TreeNode[] = [];
      const processed = new Set<number>();

      // 独立性の高いタスクから処理
      for (const task of sortedTasks) {
        if (processed.has(task.taskId)) continue;

        const node: TreeNode = {
          id: task.taskId,
          title: task.title,
          files: task.files,
          independenceScore: task.independenceScore,
          canRunParallel: task.canRunParallel,
          level: 0,
          children: [],
          dependsOn: task.dependencies.map((d) => ({
            id: d.taskId,
            title: d.title,
            sharedFiles: d.sharedFiles,
          })),
        };

        // 依存しているタスクを子として追加
        for (const dep of task.dependencies) {
          if (!processed.has(dep.taskId)) {
            const depTask = sortedTasks.find((t) => t.taskId === dep.taskId);
            if (depTask) {
              node.children.push({
                id: depTask.taskId,
                title: depTask.title,
                files: depTask.files,
                independenceScore: depTask.independenceScore,
                canRunParallel: depTask.canRunParallel,
                level: 1,
                children: [],
                dependsOn: depTask.dependencies.map((d) => ({
                  id: d.taskId,
                  title: d.title,
                  sharedFiles: d.sharedFiles,
                })),
              });
              processed.add(depTask.taskId);
            }
          }
        }

        nodes.push(node);
        processed.add(task.taskId);
      }

      return nodes;
    };

    const tree = buildTree();

    // 並列実行可能なグループを作成
    const parallelGroups: Array<{
      groupId: number;
      tasks: Array<{ id: number; title: string }>;
      canRunTogether: boolean;
    }> = [];

    const independentTasks = dependencyAnalysis.filter((t) => t.canRunParallel);
    const dependentTasks = dependencyAnalysis.filter((t) => !t.canRunParallel);

    if (independentTasks.length > 0) {
      parallelGroups.push({
        groupId: 1,
        tasks: independentTasks.map((t) => ({ id: t.taskId, title: t.title })),
        canRunTogether: true,
      });
    }

    if (dependentTasks.length > 0) {
      parallelGroups.push({
        groupId: 2,
        tasks: dependentTasks.map((t) => ({ id: t.taskId, title: t.title })),
        canRunTogether: false,
      });
    }

    return {
      taskId: task.id,
      taskTitle: task.title,
      hasSubtasks: task.subtasks.length > 0,
      subtaskCount: task.subtasks.length,
      analysis: dependencyAnalysis,
      tree,
      parallelGroups,
      summary: {
        totalTasks: subtaskFiles.length,
        independentTasks: independentTasks.length,
        dependentTasks: dependentTasks.length,
        totalFiles: new Set(subtaskFiles.flatMap((t) => t.files)).size,
        averageIndependence: Math.round(
          dependencyAnalysis.reduce((sum, t) => sum + t.independenceScore, 0) /
            dependencyAnalysis.length || 0,
        ),
      },
    };
  },
);

// SSE対応の依存度分析API
app.get(
  "/tasks/:id/dependency-analysis/stream",
  async ({ params, set }: { params: { id: string }; set: any }) => {
    const taskIdNum = parseInt(params.id);

    // SSEヘッダーを設定
    set.headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    };

    // SSEストリームコントローラーを作成
    const sseController = new SSEStreamController({
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      backoffMultiplier: 2,
    });

    const stream = sseController.createStream();

    // 非同期で分析を実行
    (async () => {
      try {
        sseController.sendStart({ taskId: taskIdNum });

        // 初期状態を保存（ロールバック用）
        sseController.saveState({ taskId: taskIdNum, status: "pending" });

        // タスクを取得（リトライ対応）
        sseController.sendProgress(10, "タスク情報を取得中...");

        const task = await sseController.executeWithRetry(async () => {
          const result = await prisma.task.findUnique({
            where: { id: taskIdNum },
            include: {
              subtasks: {
                include: {
                  prompts: true,
                },
              },
              prompts: true,
            },
          });
          if (!result) {
            throw new Error("タスクが見つかりません");
          }
          return result;
        });

        sseController.sendProgress(30, "ファイル情報を抽出中...");

        // ファイルパスを抽出する関数
        const extractFilePaths = (text: string | null): string[] => {
          if (!text) return [];
          const patterns = [
            /(?:^|\s|["'`])([\/][\w\-\.\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
            /(?:^|\s|["'`])([A-Za-z]:[\\\/][\w\-\.\\\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
            /(?:^|\s|["'`])(\.{0,2}[\/\\][\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
            /(?:^|\s|["'`])((?:src|lib|app|components|pages|features?|services?|utils?|hooks?|types?|api|routes?)[\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
          ];
          const files = new Set<string>();
          for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
              const filePath = match[1]
                .replace(/\\/g, "/")
                .replace(/^\.\//, "")
                .toLowerCase();
              if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
                files.add(filePath);
              }
            }
          }
          return Array.from(files);
        };

        const getFileName = (path: string): string => {
          const parts = path.split("/");
          return parts[parts.length - 1];
        };

        type SubtaskFileInfo = {
          id: number;
          title: string;
          files: string[];
          fileNames: string[];
        };
        const subtaskFiles: SubtaskFileInfo[] = [];

        // サブタスクのファイル情報を収集
        if (task.subtasks.length === 0) {
          const parentFiles: string[] = [];
          for (const prompt of task.prompts) {
            parentFiles.push(...extractFilePaths(prompt.optimizedPrompt));
            parentFiles.push(...extractFilePaths(prompt.originalDescription));
          }
          parentFiles.push(...extractFilePaths(task.description));
          const uniqueFiles = Array.from(new Set(parentFiles));
          subtaskFiles.push({
            id: task.id,
            title: task.title,
            files: uniqueFiles,
            fileNames: uniqueFiles.map(getFileName),
          });
        } else {
          for (let i = 0; i < task.subtasks.length; i++) {
            const subtask = task.subtasks[i];
            const files: string[] = [];
            for (const prompt of subtask.prompts) {
              files.push(...extractFilePaths(prompt.optimizedPrompt));
              files.push(...extractFilePaths(prompt.originalDescription));
            }
            files.push(...extractFilePaths(subtask.description));
            const uniqueFiles = Array.from(new Set(files));
            subtaskFiles.push({
              id: subtask.id,
              title: subtask.title,
              files: uniqueFiles,
              fileNames: uniqueFiles.map(getFileName),
            });

            // 進捗を送信
            const progress = 30 + Math.round((i / task.subtasks.length) * 30);
            sseController.sendProgress(
              progress,
              `サブタスク ${i + 1}/${task.subtasks.length} を分析中...`,
            );
          }
        }

        sseController.sendProgress(60, "依存関係を分析中...");

        // 依存度を計算
        type DependencyInfo = {
          taskId: number;
          title: string;
          files: string[];
          dependencies: Array<{
            taskId: number;
            title: string;
            sharedFiles: string[];
            dependencyScore: number;
          }>;
          independenceScore: number;
          canRunParallel: boolean;
        };

        const dependencyAnalysis: DependencyInfo[] = [];

        for (const current of subtaskFiles) {
          const dependencies: DependencyInfo["dependencies"] = [];
          for (const other of subtaskFiles) {
            if (current.id === other.id) continue;
            const sharedFiles = current.fileNames.filter((fn) =>
              other.fileNames.includes(fn),
            );
            if (sharedFiles.length > 0) {
              const score =
                current.files.length > 0
                  ? Math.round(
                      (sharedFiles.length / current.files.length) * 100,
                    )
                  : 0;
              dependencies.push({
                taskId: other.id,
                title: other.title,
                sharedFiles,
                dependencyScore: score,
              });
            }
          }
          const totalSharedFiles = new Set(
            dependencies.flatMap((d) => d.sharedFiles),
          ).size;
          const independenceScore =
            current.files.length > 0
              ? Math.round(
                  ((current.files.length - totalSharedFiles) /
                    current.files.length) *
                    100,
                )
              : 100;
          dependencyAnalysis.push({
            taskId: current.id,
            title: current.title,
            files: current.files,
            dependencies: dependencies.sort(
              (a, b) => b.dependencyScore - a.dependencyScore,
            ),
            independenceScore,
            canRunParallel:
              dependencies.length === 0 || independenceScore >= 70,
          });
        }

        sseController.sendProgress(80, "ツリー構造を生成中...");

        // ツリー構造を生成
        type TreeNode = {
          id: number;
          title: string;
          files: string[];
          independenceScore: number;
          canRunParallel: boolean;
          level: number;
          children: TreeNode[];
          dependsOn: Array<{
            id: number;
            title: string;
            sharedFiles: string[];
          }>;
        };

        const sortedTasks = [...dependencyAnalysis].sort(
          (a, b) => b.independenceScore - a.independenceScore,
        );

        const buildTree = (): TreeNode[] => {
          const nodes: TreeNode[] = [];
          const processed = new Set<number>();
          for (const t of sortedTasks) {
            if (processed.has(t.taskId)) continue;
            const node: TreeNode = {
              id: t.taskId,
              title: t.title,
              files: t.files,
              independenceScore: t.independenceScore,
              canRunParallel: t.canRunParallel,
              level: 0,
              children: [],
              dependsOn: t.dependencies.map((d) => ({
                id: d.taskId,
                title: d.title,
                sharedFiles: d.sharedFiles,
              })),
            };
            for (const dep of t.dependencies) {
              if (!processed.has(dep.taskId)) {
                const depTask = sortedTasks.find(
                  (st) => st.taskId === dep.taskId,
                );
                if (depTask) {
                  node.children.push({
                    id: depTask.taskId,
                    title: depTask.title,
                    files: depTask.files,
                    independenceScore: depTask.independenceScore,
                    canRunParallel: depTask.canRunParallel,
                    level: 1,
                    children: [],
                    dependsOn: depTask.dependencies.map((d) => ({
                      id: d.taskId,
                      title: d.title,
                      sharedFiles: d.sharedFiles,
                    })),
                  });
                  processed.add(depTask.taskId);
                }
              }
            }
            nodes.push(node);
            processed.add(t.taskId);
          }
          return nodes;
        };

        const tree = buildTree();

        sseController.sendProgress(90, "結果をまとめています...");

        // 並列実行グループを作成
        const independentTasks = dependencyAnalysis.filter(
          (t) => t.canRunParallel,
        );
        const dependentTasks = dependencyAnalysis.filter(
          (t) => !t.canRunParallel,
        );

        const parallelGroups: Array<{
          groupId: number;
          tasks: Array<{ id: number; title: string }>;
          canRunTogether: boolean;
        }> = [];
        if (independentTasks.length > 0) {
          parallelGroups.push({
            groupId: 1,
            tasks: independentTasks.map((t) => ({
              id: t.taskId,
              title: t.title,
            })),
            canRunTogether: true,
          });
        }
        if (dependentTasks.length > 0) {
          parallelGroups.push({
            groupId: 2,
            tasks: dependentTasks.map((t) => ({
              id: t.taskId,
              title: t.title,
            })),
            canRunTogether: false,
          });
        }

        // 最終結果を送信
        sseController.sendData({
          taskId: task.id,
          taskTitle: task.title,
          hasSubtasks: task.subtasks.length > 0,
          subtaskCount: task.subtasks.length,
          analysis: dependencyAnalysis,
          tree,
          parallelGroups,
          summary: {
            totalTasks: subtaskFiles.length,
            independentTasks: independentTasks.length,
            dependentTasks: dependentTasks.length,
            totalFiles: new Set(subtaskFiles.flatMap((t) => t.files)).size,
            averageIndependence: Math.round(
              dependencyAnalysis.reduce(
                (sum, t) => sum + t.independenceScore,
                0,
              ) / (dependencyAnalysis.length || 1),
            ),
          },
        });

        sseController.sendComplete({ success: true });
      } catch (error) {
        const errorMessage = getUserFriendlyErrorMessage(error);
        sseController.sendError(errorMessage, {
          originalError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        sseController.close();
      }
    })();

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
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
      const proposedChanges = fromJsonString<{
        taskId: number;
        agentConfigId?: number;
        workingDirectory?: string;
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        return { error: "Invalid proposed changes data" };
      }

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
          metadata: toJsonString({ sessionId: session.id, taskId: task.id }),
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
              metadata: toJsonString({
                sessionId: session.id,
                taskId: task.id,
                success: result.success,
              }),
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
    } else if (approval.requestType === "code_review") {
      // コードレビュー承認 → コミット＆PR作成
      const proposedChanges = fromJsonString<{
        taskId: number;
        sessionId: number;
        workingDirectory: string;
        branchName?: string;
        diff: string;
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        return { error: "Invalid proposed changes data" };
      }

      const task = approval.config.task;
      const workDir = proposedChanges.workingDirectory;

      // コミットメッセージを作成
      const commitMessage = `feat: ${task.title}`;

      // 変更をコミット
      const commitResult = await orchestrator.commitChanges(
        workDir,
        commitMessage,
        task.title,
      );

      if (!commitResult.success) {
        await prisma.notification.create({
          data: {
            type: "agent_error",
            title: "コミット失敗",
            message: `「${task.title}」のコミットに失敗しました: ${commitResult.error}`,
            link: `/tasks/${task.id}`,
          },
        });
        return { success: false, error: commitResult.error };
      }

      // PRを作成
      const prBody = `## 概要
${task.description || task.title}

## 変更内容
Claude Codeによる自動実装

## 関連タスク
Task ID: ${task.id}

---
🤖 Generated by rapitas AI Development Mode`;

      const prResult = await orchestrator.createPullRequest(
        workDir,
        task.title,
        prBody,
        "main", // TODO: 設定可能にする
      );

      if (prResult.success) {
        // タスクにPR情報を紐付け
        if (prResult.prNumber) {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: "in_review" },
          });
        }

        // 通知を作成
        await prisma.notification.create({
          data: {
            type: "pr_approved",
            title: "PR作成完了",
            message: `「${task.title}」のPRが作成されました`,
            link: prResult.prUrl || `/tasks/${task.id}`,
            metadata: toJsonString({
              taskId: task.id,
              commitHash: commitResult.commitHash,
              prUrl: prResult.prUrl,
              prNumber: prResult.prNumber,
            }),
          },
        });

        return {
          success: true,
          commitHash: commitResult.commitHash,
          prUrl: prResult.prUrl,
          prNumber: prResult.prNumber,
        };
      } else {
        // PR作成失敗（コミットは成功している）
        await prisma.notification.create({
          data: {
            type: "agent_error",
            title: "PR作成失敗",
            message: `「${task.title}」のPR作成に失敗しました: ${prResult.error}`,
            link: `/tasks/${task.id}`,
            metadata: toJsonString({ commitHash: commitResult.commitHash }),
          },
        });

        return {
          success: false,
          commitHash: commitResult.commitHash,
          error: prResult.error,
        };
      }
    } else if (approval.requestType === "subtask_creation") {
      // サブタスク作成の承認
      const proposedChanges = fromJsonString<{
        subtasks: SubtaskProposal[];
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        return { error: "Invalid proposed changes data" };
      }

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

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        config: {
          include: { task: true },
        },
      },
    });

    if (!approval) {
      return { error: "Approval request not found" };
    }

    // 承認リクエストを更新
    await prisma.approvalRequest.update({
      where: { id: parseInt(id) },
      data: {
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    // コードレビュー却下の場合は変更を元に戻す
    if (approval.requestType === "code_review") {
      const proposedChanges = fromJsonString<{
        workingDirectory: string;
      }>(approval.proposedChanges);

      if (!proposedChanges) {
        return { error: "Invalid proposed changes data" };
      }

      const reverted = await orchestrator.revertChanges(
        proposedChanges.workingDirectory,
      );

      await prisma.notification.create({
        data: {
          type: "pr_changes_requested",
          title: "コードレビュー却下",
          message: `「${approval.config.task.title}」のコードレビューが却下されました${reason ? `: ${reason}` : ""}。変更は元に戻されました。`,
          link: `/tasks/${approval.config.taskId}`,
        },
      });

      return { success: true, reverted };
    }

    return { success: true };
  },
);

// コードレビュー承認（コミット + PR作成）
app.post(
  "/approvals/:id/approve-code-review",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { commitMessage: string; baseBranch?: string };
  }) => {
    const { id } = params;
    const { commitMessage, baseBranch = "main" } = body;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      return { error: "Approval request not found" };
    }

    if (approval.status !== "pending") {
      return { error: "Approval request is not pending" };
    }

    if (approval.requestType !== "code_review") {
      return { error: "This endpoint is only for code_review requests" };
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
      files?: string[];
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory ||
      approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      return { error: "Working directory not found" };
    }

    try {
      // Gitでコミット作成
      const commitResult = await orchestrator.createCommit(
        workingDirectory,
        commitMessage,
      );

      // PR作成
      const prResult = await githubService.createPullRequest(
        workingDirectory,
        commitResult.branch,
        baseBranch,
        `[Task-${approval.config.taskId}] ${commitMessage}`,
        `## 概要\n\n${approval.description || "AIエージェントによる自動実装"}\n\n関連タスク: #${approval.config.taskId}`,
      );

      // 承認リクエストを更新
      await prisma.approvalRequest.update({
        where: { id: parseInt(id) },
        data: {
          status: "approved",
          approvedAt: new Date(),
        },
      });

      // タスクにPR情報を紐付け
      if (prResult.prNumber) {
        await prisma.task.update({
          where: { id: approval.config.taskId },
          data: { githubPrId: prResult.prNumber },
        });
      }

      // 通知を作成
      await prisma.notification.create({
        data: {
          type: "pr_approved",
          title: "PR作成完了",
          message: `「${approval.config.task.title}」のPRを作成しました`,
          link: prResult.prUrl || `/tasks/${approval.config.taskId}`,
          metadata: toJsonString({
            prNumber: prResult.prNumber,
            prUrl: prResult.prUrl,
            commitHash: commitResult.hash,
          }),
        },
      });

      return {
        success: true,
        commit: commitResult,
        pr: prResult,
      };
    } catch (error: any) {
      console.error("Code review approval failed:", error);
      return { error: error.message || "Code review approval failed" };
    }
  },
);

// コードレビュー却下（変更を破棄）
app.post(
  "/approvals/:id/reject-code-review",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { reason?: string };
  }) => {
    const { id } = params;
    const { reason } = body;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      return { error: "Approval request not found" };
    }

    if (approval.requestType !== "code_review") {
      return { error: "This endpoint is only for code_review requests" };
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory ||
      approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      return { error: "Working directory not found" };
    }

    try {
      // 変更を元に戻す
      const reverted = await orchestrator.revertChanges(workingDirectory);

      // 承認リクエストを更新
      await prisma.approvalRequest.update({
        where: { id: parseInt(id) },
        data: {
          status: "rejected",
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      });

      // 通知を作成
      await prisma.notification.create({
        data: {
          type: "pr_changes_requested",
          title: "コードレビュー却下",
          message: `「${approval.config.task.title}」の変更を破棄しました${reason ? `: ${reason}` : ""}`,
          link: `/tasks/${approval.config.taskId}`,
        },
      });

      return { success: true, reverted };
    } catch (error: any) {
      console.error("Code review rejection failed:", error);
      return { error: error.message || "Code review rejection failed" };
    }
  },
);

// 修正依頼（フィードバックを送信して再実行）
app.post(
  "/approvals/:id/request-changes",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: {
      feedback: string;
      comments: { file?: string; content: string; type: string }[];
    };
  }) => {
    const { id } = params;
    const { feedback, comments } = body;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      return { error: "Approval request not found" };
    }

    if (approval.requestType !== "code_review") {
      return { error: "This endpoint is only for code_review requests" };
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
      sessionId?: number;
      implementationSummary?: string;
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory ||
      approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      return { error: "Working directory not found" };
    }

    const task = approval.config.task;
    if (!task) {
      return { error: "Task not found" };
    }

    try {
      // 1. 変更を元に戻す
      await orchestrator.revertChanges(workingDirectory);

      // 2. フィードバックを含む新しい指示を作成
      const feedbackInstructions = [];

      if (feedback) {
        feedbackInstructions.push(`## 全体的なフィードバック\n${feedback}`);
      }

      if (comments && comments.length > 0) {
        feedbackInstructions.push("\n## 具体的な修正依頼:");
        comments.forEach((comment, index) => {
          const typeLabel =
            comment.type === "change_request"
              ? "修正"
              : comment.type === "question"
                ? "質問"
                : "コメント";
          const fileInfo = comment.file ? ` (${comment.file})` : "";
          feedbackInstructions.push(
            `${index + 1}. [${typeLabel}]${fileInfo}: ${comment.content}`,
          );
        });
      }

      const additionalInstructions = feedbackInstructions.join("\n");

      // 元の実装説明を含める（コンテキスト用）
      const previousImplementation = proposedChanges?.implementationSummary
        ? `\n\n## 前回の実装内容（参考）:\n${proposedChanges.implementationSummary.substring(0, 1000)}`
        : "";

      const fullInstruction = `
以下のタスクを実装してください。前回の実装に対してフィードバックがありますので、それを踏まえて修正・改善してください。

## タスク
${task.title}
${task.description || ""}

${additionalInstructions}
${previousImplementation}

上記のフィードバックを反映した実装をお願いします。
`;

      // 3. 承認リクエストのステータスを更新
      await prisma.approvalRequest.update({
        where: { id: parseInt(id) },
        data: {
          status: "rejected",
          rejectedAt: new Date(),
          rejectionReason:
            "修正依頼: " +
            (feedback || comments.map((c) => c.content).join(", ")).substring(
              0,
              200,
            ),
        },
      });

      // 4. 新しいセッションを作成して再実行
      const session = await prisma.agentSession.create({
        data: {
          configId: approval.configId,
          status: "pending",
          metadata: toJsonString({
            previousApprovalId: parseInt(id),
            feedbackIteration: true,
          }),
        },
      });

      // 5. エージェントを非同期で実行
      const agentConfig = await prisma.aIAgentConfig.findFirst({
        where: { isDefault: true, isActive: true },
      });

      const timeout = 900000; // 15分

      orchestrator
        .executeTask(
          {
            id: task.id,
            title: task.title,
            description: fullInstruction,
            context: task.executionInstructions || undefined,
            workingDirectory,
          },
          {
            taskId: task.id,
            sessionId: session.id,
            agentConfigId: agentConfig?.id,
            workingDirectory,
            timeout,
          },
        )
        .then(async (result) => {
          if (result.success) {
            const diff = await orchestrator.getFullGitDiff(workingDirectory);
            const structuredDiff = await orchestrator.getDiff(workingDirectory);

            if (diff && diff !== "No changes detected") {
              const implementationSummary =
                result.output || "修正が完了しました。";

              // 新しいコードレビュー承認リクエストを作成
              const newApprovalRequest = await prisma.approvalRequest.create({
                data: {
                  configId: approval.configId,
                  requestType: "code_review",
                  title: `「${task.title}」のコードレビュー（修正版）`,
                  description: implementationSummary,
                  proposedChanges: toJsonString({
                    taskId: task.id,
                    sessionId: session.id,
                    workingDirectory,
                    diff,
                    structuredDiff,
                    implementationSummary,
                    executionTimeMs: result.executionTimeMs,
                    feedbackIteration: true,
                    previousFeedback: feedback,
                    previousComments: comments,
                  }),
                  estimatedChanges: toJsonString({
                    diff,
                    filesChanged: structuredDiff.length,
                    summary: implementationSummary.substring(0, 500),
                  }),
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
              });

              // 通知
              await prisma.notification.create({
                data: {
                  type: "pr_review_requested",
                  title: "修正版レビュー依頼",
                  message: `「${task.title}」の修正が完了しました。再度レビューをお願いします。`,
                  link: `/approvals/${newApprovalRequest.id}`,
                },
              });
            }
          }
        })
        .catch(console.error);

      return {
        success: true,
        message: "修正依頼を受け付けました。再実行を開始します。",
        sessionId: session.id,
      };
    } catch (error: any) {
      console.error("Request changes failed:", error);
      return { error: error.message || "Request changes failed" };
    }
  },
);

// 差分を取得
app.get(
  "/approvals/:id/diff",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      return { error: "Approval request not found" };
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory ||
      approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      return { error: "Working directory not found" };
    }

    try {
      const diff = await orchestrator.getDiff(workingDirectory);
      return { files: diff };
    } catch (error: any) {
      console.error("Failed to get diff:", error);
      return { error: error.message || "Failed to get diff" };
    }
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
          const proposedChanges = fromJsonString<{
            taskId: number;
            agentConfigId?: number;
            workingDirectory?: string;
          }>(approval.proposedChanges);
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
                workingDirectory: proposedChanges?.workingDirectory,
              },
              {
                taskId: task.id,
                sessionId: session.id,
                agentConfigId: proposedChanges?.agentConfigId,
                workingDirectory: proposedChanges?.workingDirectory,
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
          const proposedChanges = fromJsonString<{
            subtasks: SubtaskProposal[];
          }>(approval.proposedChanges);

          for (const subtask of proposedChanges?.subtasks || []) {
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
    const notificationId = parseInt(id);

    // 存在確認
    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!existing) {
      return new Response(JSON.stringify({ error: "Notification not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    return { success: true, id: notificationId };
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
  const apiKeyConfigured = await isApiKeyConfiguredAsync();
  return {
    ...settings,
    claudeApiKeyConfigured: apiKeyConfigured,
  };
});

// 設定更新
app.patch(
  "/settings",
  async ({
    body,
  }: {
    body: { developerModeDefault?: boolean; aiTaskAnalysisDefault?: boolean };
  }) => {
    const { developerModeDefault, aiTaskAnalysisDefault } = body;

    let settings = await prisma.userSettings.findFirst();
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          developerModeDefault: developerModeDefault ?? false,
          aiTaskAnalysisDefault: aiTaskAnalysisDefault ?? false,
        },
      });
    } else {
      settings = await prisma.userSettings.update({
        where: { id: settings.id },
        data: {
          ...(developerModeDefault !== undefined && { developerModeDefault }),
          ...(aiTaskAnalysisDefault !== undefined && { aiTaskAnalysisDefault }),
        },
      });
    }

    return settings;
  },
);

// API設定状態の確認
app.get("/settings/api-status", async () => {
  const apiKeyConfigured = await isApiKeyConfiguredAsync();
  return {
    claudeApiKeyConfigured: apiKeyConfigured,
  };
});

// ==================== AI Chat API ====================

// AIチャット（非ストリーミング）
app.post(
  "/ai/chat",
  async ({
    body,
    set,
  }: {
    body: {
      message: string;
      conversationHistory?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
    };
    set: { status: number };
  }) => {
    const { message, conversationHistory = [], systemPrompt } = body;

    if (!message || message.trim() === "") {
      set.status = 400;
      return { error: "メッセージが必要です" };
    }

    // APIキーの確認
    const settings = await prisma.userSettings.findFirst();
    if (!settings?.claudeApiKeyEncrypted) {
      set.status = 400;
      return {
        error:
          "APIキーが設定されていません。設定画面でClaude APIキーを設定してください。",
      };
    }

    let apiKey: string;
    try {
      apiKey = decrypt(settings.claudeApiKeyEncrypted);
    } catch {
      set.status = 500;
      return { error: "APIキーの復号化に失敗しました" };
    }

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey });

    const defaultSystemPrompt = `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習計画に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`;

    try {
      const messages = [
        ...conversationHistory.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
        { role: "user" as const, content: message },
      ];

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt || defaultSystemPrompt,
        messages,
      });

      const content = response.content[0];
      if (content.type === "text") {
        return { success: true, message: content.text };
      }

      return { success: true, message: "" };
    } catch (error: any) {
      console.error("AI Chat Error:", error);
      set.status = 500;
      return { error: error.message || "AIとの通信中にエラーが発生しました" };
    }
  },
);

// AIチャット（ストリーミング）
app.post(
  "/ai/chat/stream",
  async ({
    body,
    set,
  }: {
    body: {
      message: string;
      conversationHistory?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
    };
    set: { headers: Record<string, string>; status: number };
  }) => {
    const { message, conversationHistory = [], systemPrompt } = body;

    if (!message || message.trim() === "") {
      set.status = 400;
      return { error: "メッセージが必要です" };
    }

    // APIキーの確認
    const settings = await prisma.userSettings.findFirst();
    if (!settings?.claudeApiKeyEncrypted) {
      set.status = 400;
      return {
        error:
          "APIキーが設定されていません。設定画面でClaude APIキーを設定してください。",
      };
    }

    let apiKey: string;
    try {
      apiKey = decrypt(settings.claudeApiKeyEncrypted);
    } catch {
      set.status = 500;
      return { error: "APIキーの復号化に失敗しました" };
    }

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey });

    const defaultSystemPrompt = `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習計画に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`;

    set.headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    };

    const messages = [
      ...conversationHistory.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            const stream = anthropic.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 2048,
              system: systemPrompt || defaultSystemPrompt,
              messages,
            });

            for await (const event of stream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                const data = JSON.stringify({ content: event.delta.text });
                controller.enqueue(
                  new TextEncoder().encode(`data: ${data}\n\n`),
                );
              }
            }

            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          } catch (error: any) {
            console.error("AI Chat Stream Error:", error);
            const errorData = JSON.stringify({
              error: error.message || "AIとの通信中にエラーが発生しました",
            });
            controller.enqueue(
              new TextEncoder().encode(`data: ${errorData}\n\n`),
            );
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  },
);

// APIキーの保存（暗号化）
app.post(
  "/settings/api-key",
  async ({ body }: { body: { apiKey: string } }) => {
    const { apiKey } = body;

    if (!apiKey || apiKey.trim() === "") {
      return { error: "APIキーが必要です" };
    }

    // 暗号化
    const encryptedKey = encrypt(apiKey);

    // 設定を取得または作成
    let settings = await prisma.userSettings.findFirst();
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          claudeApiKeyEncrypted: encryptedKey,
        },
      });
    } else {
      settings = await prisma.userSettings.update({
        where: { id: settings.id },
        data: {
          claudeApiKeyEncrypted: encryptedKey,
        },
      });
    }

    return {
      success: true,
      maskedKey: maskApiKey(apiKey),
    };
  },
);

// マスクされたAPIキーを取得
app.get("/settings/api-key", async () => {
  const settings = await prisma.userSettings.findFirst();

  if (!settings?.claudeApiKeyEncrypted) {
    return {
      configured: false,
      maskedKey: null,
    };
  }

  try {
    const decryptedKey = decrypt(settings.claudeApiKeyEncrypted);
    return {
      configured: true,
      maskedKey: maskApiKey(decryptedKey),
    };
  } catch {
    return {
      configured: false,
      maskedKey: null,
      error: "復号化に失敗しました",
    };
  }
});

// APIキーの削除
app.delete("/settings/api-key", async () => {
  const settings = await prisma.userSettings.findFirst();

  if (!settings) {
    return { success: true };
  }

  await prisma.userSettings.update({
    where: { id: settings.id },
    data: {
      claudeApiKeyEncrypted: null,
    },
  });

  return { success: true };
});

// ==================== Directory Browser API ====================

// ディレクトリ一覧を取得
app.get(
  "/directories/browse",
  async ({ query }: { query: { path?: string } }) => {
    const { path: dirPath } = query as { path?: string };

    try {
      // パスが指定されていない場合はドライブ一覧を返す
      if (!dirPath || dirPath.trim() === "") {
        // Windows の場合はドライブ一覧を返す
        if (process.platform === "win32") {
          const { execSync } = require("child_process");
          try {
            const result = execSync("wmic logicaldisk get name", {
              encoding: "utf8",
            });
            const drives = result
              .split("\n")
              .filter((line: string) => /^[A-Z]:/.test(line.trim()))
              .map((line: string) => line.trim());

            return {
              path: "",
              parent: null,
              directories: drives.map((drive: string) => ({
                name: `${drive} ドライブ`,
                path: drive + "\\",
                isDirectory: true,
              })),
              isDriveList: true,
            };
          } catch (e) {
            console.error("Failed to get drive list:", e);
            // フォールバック: C: と D: を返す
            return {
              path: "",
              parent: null,
              directories: [
                { name: "C: ドライブ", path: "C:\\", isDirectory: true },
                { name: "D: ドライブ", path: "D:\\", isDirectory: true },
              ],
              isDriveList: true,
            };
          }
        } else {
          // Unix系の場合はルートを返す
          return {
            path: "/",
            parent: null,
            directories: fs
              .readdirSync("/", { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .filter((entry) => !entry.name.startsWith("."))
              .map((entry) => ({
                name: entry.name,
                path: "/" + entry.name,
                isDirectory: true,
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          };
        }
      }

      let targetPath = dirPath.trim();

      // Windowsドライブレター対応（C: → C:\）
      if (process.platform === "win32" && /^[A-Z]:$/i.test(targetPath)) {
        targetPath = targetPath + "\\";
      }

      // パスの正規化
      const normalizedPath = path.resolve(targetPath);

      // ディレクトリが存在するか確認
      if (!fs.existsSync(normalizedPath)) {
        return {
          error: `パスが存在しません: ${normalizedPath}`,
          path: normalizedPath,
        };
      }

      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { error: "ディレクトリではありません", path: normalizedPath };
      }

      // ディレクトリ内容を取得
      let entries;
      try {
        entries = fs.readdirSync(normalizedPath, { withFileTypes: true });
      } catch (e: any) {
        return {
          error: `アクセスできません: ${e.message}`,
          path: normalizedPath,
        };
      }

      const directories = entries
        .filter((entry) => {
          try {
            return entry.isDirectory();
          } catch {
            return false;
          }
        })
        .filter((entry) => !entry.name.startsWith(".")) // 隠しフォルダを除外
        .filter((entry) => {
          // システムフォルダを除外（Windows）
          const excludeNames = [
            "$Recycle.Bin",
            "$RECYCLE.BIN",
            "System Volume Information",
            "Recovery",
          ];
          return !excludeNames.includes(entry.name);
        })
        .map((entry) => ({
          name: entry.name,
          path: path.join(normalizedPath, entry.name),
          isDirectory: true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // 親ディレクトリを計算
      const parentPath = path.dirname(normalizedPath);
      // ドライブルート（C:\など）の場合はparentをnullにしてドライブ一覧に戻れるようにする
      const isDriveRoot =
        process.platform === "win32" && /^[A-Z]:\\?$/i.test(normalizedPath);
      const hasParent = parentPath !== normalizedPath && !isDriveRoot;

      return {
        path: normalizedPath,
        parent: hasParent ? parentPath : null,
        directories,
        isGitRepo: fs.existsSync(path.join(normalizedPath, ".git")),
        isDriveList: false,
      };
    } catch (error: any) {
      console.error("Directory browse error:", error);
      return { error: error.message || "ディレクトリの取得に失敗しました" };
    }
  },
);

// パスの検証
app.post(
  "/directories/validate",
  async ({ body }: { body: { path: string } }) => {
    const { path: dirPath } = body;

    if (!dirPath) {
      return { valid: false, error: "パスが指定されていません" };
    }

    try {
      const normalizedPath = path.resolve(dirPath);

      if (!fs.existsSync(normalizedPath)) {
        return { valid: false, error: "パスが存在しません" };
      }

      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { valid: false, error: "ディレクトリではありません" };
      }

      const isGitRepo = fs.existsSync(path.join(normalizedPath, ".git"));

      return {
        valid: true,
        path: normalizedPath,
        isGitRepo,
      };
    } catch (error: any) {
      return { valid: false, error: error.message || "検証に失敗しました" };
    }
  },
);

// ==================== Favorite Directories API ====================

// お気に入りディレクトリ一覧を取得
app.get("/directories/favorites", async () => {
  try {
    const favorites = await prisma.favoriteDirectory.findMany({
      orderBy: { createdAt: "desc" },
    });
    return favorites;
  } catch (error: any) {
    console.error("Favorite directories fetch error:", error);
    return { error: error.message || "お気に入りの取得に失敗しました" };
  }
});

// お気に入りディレクトリを追加
app.post(
  "/directories/favorites",
  async ({ body }: { body: { path: string; name?: string } }) => {
    const { path: dirPath, name } = body;

    if (!dirPath) {
      return { error: "パスが指定されていません" };
    }

    try {
      const normalizedPath = path.resolve(dirPath);

      // パスの存在確認
      if (!fs.existsSync(normalizedPath)) {
        return { error: "パスが存在しません" };
      }

      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { error: "ディレクトリではありません" };
      }

      // 既に登録されているか確認
      const existing = await prisma.favoriteDirectory.findUnique({
        where: { path: normalizedPath },
      });

      if (existing) {
        return { error: "このディレクトリは既にお気に入りに登録されています" };
      }

      // Gitリポジトリかどうかを確認
      const isGitRepo = fs.existsSync(path.join(normalizedPath, ".git"));

      // 表示名を決定（指定がなければフォルダ名を使用）
      const displayName = name || path.basename(normalizedPath);

      const favorite = await prisma.favoriteDirectory.create({
        data: {
          path: normalizedPath,
          name: displayName,
          isGitRepo,
        },
      });

      return favorite;
    } catch (error: any) {
      console.error("Favorite directory create error:", error);
      return { error: error.message || "お気に入りの登録に失敗しました" };
    }
  },
);

// お気に入りディレクトリを削除
app.delete(
  "/directories/favorites/:id",
  async ({ params }: { params: { id: string } }) => {
    const { id } = params;

    try {
      const favoriteId = parseInt(id);
      if (isNaN(favoriteId)) {
        return { error: "無効なIDです" };
      }

      const existing = await prisma.favoriteDirectory.findUnique({
        where: { id: favoriteId },
      });

      if (!existing) {
        return { error: "お気に入りが見つかりません" };
      }

      await prisma.favoriteDirectory.delete({
        where: { id: favoriteId },
      });

      return { success: true };
    } catch (error: any) {
      console.error("Favorite directory delete error:", error);
      return { error: error.message || "お気に入りの削除に失敗しました" };
    }
  },
);

// お気に入りディレクトリの名前を更新
app.patch(
  "/directories/favorites/:id",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { name: string };
  }) => {
    const { id } = params;
    const { name } = body;

    try {
      const favoriteId = parseInt(id);
      if (isNaN(favoriteId)) {
        return { error: "無効なIDです" };
      }

      const existing = await prisma.favoriteDirectory.findUnique({
        where: { id: favoriteId },
      });

      if (!existing) {
        return { error: "お気に入りが見つかりません" };
      }

      const updated = await prisma.favoriteDirectory.update({
        where: { id: favoriteId },
        data: { name },
      });

      return updated;
    } catch (error: any) {
      console.error("Favorite directory update error:", error);
      return { error: error.message || "お気に入りの更新に失敗しました" };
    }
  },
);

// ==================== GitHub Integration API ====================

const githubService = new GitHubService(prisma);
const orchestrator = createOrchestrator(prisma);

// オーケストレーターのイベントをリアルタイムサービスに転送
orchestrator.addEventListener((event) => {
  const executionChannel = `execution:${event.executionId}`;
  const sessionChannel = `session:${event.sessionId}`;

  // 両方のチャンネルにブロードキャストする関数
  const broadcastToBoth = (
    eventType: string,
    data: Record<string, unknown>,
  ) => {
    realtimeService.broadcast(executionChannel, eventType, data);
    realtimeService.broadcast(sessionChannel, eventType, data);
  };

  switch (event.type) {
    case "execution_started":
      broadcastToBoth("execution_started", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_output":
      const outputData = event.data as { output: string; isError: boolean };
      // 両チャンネルに送信
      realtimeService.broadcast(executionChannel, "execution_output", {
        executionId: event.executionId,
        output: outputData.output,
        isError: outputData.isError,
        timestamp: new Date().toISOString(),
      });
      realtimeService.broadcast(sessionChannel, "execution_output", {
        executionId: event.executionId,
        output: outputData.output,
        isError: outputData.isError,
        timestamp: new Date().toISOString(),
      });
      break;
    case "execution_completed":
      broadcastToBoth("execution_completed", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        result: event.data,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_failed":
      broadcastToBoth("execution_failed", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        error: event.data,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_cancelled":
      broadcastToBoth("execution_cancelled", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        timestamp: event.timestamp.toISOString(),
      });
      break;
  }
});

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

// タスクに対してエージェントを実行（自動実行モード：実行→差分レビュー→承認→コミット&PR）
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
      instruction?: string; // 追加の実装指示
      branchName?: string; // 作業ブランチ名
      useTaskAnalysis?: boolean; // AIタスク分析を使用するか
      optimizedPrompt?: string; // 最適化されたプロンプト
    };
    set: any;
  }) => {
    const { id } = params;
    const taskIdNum = parseInt(id);
    const {
      agentConfigId,
      workingDirectory,
      timeout,
      instruction,
      branchName,
      useTaskAnalysis,
      optimizedPrompt,
    } = body;

    // タスクを取得（テーマ情報も含む）
    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        developerModeConfig: true,
        theme: true,
      },
    });

    if (!task) {
      set.status = 404;
      return { error: "Task not found" };
    }

    // 作業ディレクトリを決定（優先順位: 指定 > テーマ設定 > カレントディレクトリ）
    const workDir =
      workingDirectory || task.theme?.workingDirectory || process.cwd();

    // テーマが開発プロジェクトでない場合の警告
    if (!task.theme?.isDevelopment && !workingDirectory) {
      console.warn(
        `Task ${taskIdNum} is not in a development theme. Using current directory.`,
      );
    }

    // セッションを作成
    let developerModeConfig = task.developerModeConfig;
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

    // ブランチを作成（指定がある場合）
    if (branchName) {
      const branchCreated = await orchestrator.createBranch(
        workDir,
        branchName,
      );
      if (!branchCreated) {
        return { error: "Failed to create branch", branchName };
      }
    }

    // 通知を送信
    await prisma.notification.create({
      data: {
        type: "agent_execution_started",
        title: "エージェント実行開始",
        message: `「${task.title}」の自動実行を開始しました`,
        link: `/tasks/${taskIdNum}`,
        metadata: toJsonString({ sessionId: session.id, taskId: taskIdNum }),
      },
    });

    // 実装指示を構築（最適化されたプロンプトを優先）
    let fullInstruction: string;
    if (optimizedPrompt) {
      // 最適化されたプロンプトがある場合はそれを使用
      fullInstruction = instruction
        ? `${optimizedPrompt}\n\n追加指示:\n${instruction}`
        : optimizedPrompt;
      console.log(`[API] Using optimized prompt for task ${taskIdNum}`);
    } else {
      // 従来通りタスクの説明を使用
      fullInstruction = instruction
        ? `${task.description || task.title}\n\n追加指示:\n${instruction}`
        : task.description || task.title;
    }

    // AIタスク分析結果を取得（useTaskAnalysisが有効な場合）
    let analysisInfo:
      | {
          summary: string;
          complexity: "simple" | "medium" | "complex";
          estimatedTotalHours: number;
          subtasks: Array<{
            title: string;
            description: string;
            estimatedHours: number;
            priority: "low" | "medium" | "high" | "urgent";
            order: number;
            dependencies?: number[];
          }>;
          reasoning: string;
          tips?: string[];
        }
      | undefined;

    if (useTaskAnalysis && developerModeConfig) {
      // 最新の分析アクションを取得
      const latestAnalysisAction = await prisma.agentAction.findFirst({
        where: {
          session: {
            configId: developerModeConfig.id,
          },
          actionType: "analysis",
          status: "success",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (latestAnalysisAction?.output) {
        try {
          const analysisOutput = fromJsonString<any>(
            latestAnalysisAction.output,
          );
          if (analysisOutput?.summary && analysisOutput?.suggestedSubtasks) {
            analysisInfo = {
              summary: analysisOutput.summary,
              complexity: analysisOutput.complexity || "medium",
              estimatedTotalHours: analysisOutput.estimatedTotalHours || 0,
              subtasks: (analysisOutput.suggestedSubtasks || []).map(
                (st: any) => ({
                  title: st.title,
                  description: st.description || "",
                  estimatedHours: st.estimatedHours || 0,
                  priority: st.priority || "medium",
                  order: st.order || 0,
                  dependencies: st.dependencies,
                }),
              ),
              reasoning: analysisOutput.reasoning || "",
              tips: analysisOutput.tips,
            };
            console.log(`[API] Using AI task analysis for task ${taskIdNum}`);
            console.log(
              `[API] Analysis subtasks count: ${analysisInfo.subtasks.length}`,
            );
          }
        } catch (e) {
          console.error(`[API] Failed to parse analysis result:`, e);
        }
      } else {
        console.log(`[API] No analysis result found for task ${taskIdNum}`);
      }
    }

    // 非同期でClaude Code実行
    orchestrator
      .executeTask(
        {
          id: taskIdNum,
          title: task.title,
          description: fullInstruction,
          context: task.executionInstructions || undefined,
          workingDirectory: workDir,
        },
        {
          taskId: taskIdNum,
          sessionId: session.id,
          agentConfigId,
          workingDirectory: workDir,
          timeout,
          analysisInfo, // AIタスク分析結果を渡す
        },
      )
      .then(async (result) => {
        if (result.success) {
          // 実行成功 → git diffを取得してレビュー依頼を作成
          const diff = await orchestrator.getFullGitDiff(workDir);
          const structuredDiff = await orchestrator.getDiff(workDir);

          if (diff && diff !== "No changes detected") {
            // Claude Codeの出力から実装説明を抽出
            const implementationSummary =
              result.output || "実装が完了しました。";

            // コードレビュー承認リクエストを作成
            const approvalRequest = await prisma.approvalRequest.create({
              data: {
                configId: developerModeConfig!.id,
                requestType: "code_review",
                title: `「${task.title}」のコードレビュー`,
                description: implementationSummary,
                proposedChanges: toJsonString({
                  taskId: taskIdNum,
                  sessionId: session.id,
                  workingDirectory: workDir,
                  branchName,
                  diff,
                  structuredDiff, // 構造化された差分情報
                  implementationSummary, // Claude Codeの出力
                  executionTimeMs: result.executionTimeMs,
                }),
                executionType: "code_review",
                estimatedChanges: toJsonString({
                  diff,
                  filesChanged: structuredDiff.length,
                  summary: implementationSummary.substring(0, 500),
                }),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7日間
              },
            });

            // レビュー依頼通知
            await prisma.notification.create({
              data: {
                type: "pr_review_requested",
                title: "コードレビュー依頼",
                message: `「${task.title}」の実装が完了しました。レビューをお願いします。`,
                link: `/approvals/${approvalRequest.id}`,
                metadata: toJsonString({
                  approvalRequestId: approvalRequest.id,
                  sessionId: session.id,
                  taskId: taskIdNum,
                }),
              },
            });
          } else {
            // 変更なし
            await prisma.notification.create({
              data: {
                type: "agent_execution_complete",
                title: "エージェント実行完了（変更なし）",
                message: `「${task.title}」の実行が完了しましたが、コード変更はありませんでした。`,
                link: `/tasks/${taskIdNum}`,
                metadata: toJsonString({
                  sessionId: session.id,
                  taskId: taskIdNum,
                }),
              },
            });
          }
        } else {
          // 実行失敗
          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "エージェント実行失敗",
              message: `「${task.title}」の自動実行が失敗しました: ${result.errorMessage}`,
              link: `/tasks/${taskIdNum}`,
              metadata: toJsonString({
                sessionId: session.id,
                taskId: taskIdNum,
              }),
            },
          });
        }
      })
      .catch(async (error) => {
        console.error("Agent execution error:", error);
        await prisma.notification.create({
          data: {
            type: "agent_error",
            title: "エージェント実行エラー",
            message: `「${task.title}」の実行中にエラーが発生しました`,
            link: `/tasks/${taskIdNum}`,
          },
        });
      });

    return {
      success: true,
      sessionId: session.id,
      taskId: taskIdNum,
      workingDirectory: workDir,
      message:
        "エージェント実行を開始しました。リアルタイムで進捗を確認できます。",
    };
  },
);

// Claude CLI診断エンドポイント
app.get("/agents/diagnose", async () => {
  const { spawn } = await import("child_process");
  const claudePath = process.env.CLAUDE_CODE_PATH || "claude";

  console.log("[Diagnose] Testing Claude CLI...");
  console.log("[Diagnose] Claude path:", claudePath);
  console.log("[Diagnose] Platform:", process.platform);

  const results: {
    step: string;
    success: boolean;
    output?: string;
    error?: string;
    duration?: number;
  }[] = [];

  // Step 1: Test claude --version
  const versionResult = await new Promise<{
    success: boolean;
    output?: string;
    error?: string;
    duration: number;
  }>((resolve) => {
    const startTime = Date.now();
    const proc = spawn(claudePath, ["--version"], { shell: true });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: "Timeout (10s)",
        duration: Date.now() - startTime,
      });
    }, 10000);

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
        duration: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      });
    });
  });

  results.push({ step: "claude --version", ...versionResult });
  console.log("[Diagnose] Version check:", versionResult);

  // Step 2: Test simple prompt with spawn and explicit cmd.exe
  if (versionResult.success) {
    const promptResult = await new Promise<{
      success: boolean;
      output?: string;
      error?: string;
      duration: number;
    }>((resolve) => {
      const startTime = Date.now();

      // Windows: cmd.exe /c を使用して正しくコマンドを実行
      const isWindows = process.platform === "win32";
      let proc;

      if (isWindows) {
        // cmd.exe経由で実行 - コマンド全体を1つの文字列として渡す
        const fullCommand = `${claudePath} --dangerously-skip-permissions -p "Say hello"`;
        console.log("[Diagnose] Windows full command:", fullCommand);
        proc = spawn("cmd.exe", ["/c", fullCommand], {
          env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
          windowsHide: true,
        });
      } else {
        proc = spawn(
          claudePath,
          ["--dangerously-skip-permissions", "-p", "Say hello"],
          {
            env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
          },
        );
      }

      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        console.log("[Diagnose] Timeout, killing process");
        proc.kill();
        resolve({
          success: false,
          error: "Timeout (90s)",
          duration: Date.now() - startTime,
        });
      }, 90000);

      proc.stdout?.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log("[Diagnose] stdout chunk:", chunk.substring(0, 100));
      });

      proc.stderr?.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log("[Diagnose] stderr chunk:", chunk.substring(0, 100));
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        console.log(
          "[Diagnose] Process closed, code:",
          code,
          "stdout length:",
          stdout.length,
        );
        resolve({
          success: code === 0,
          output: stdout.substring(0, 500),
          error:
            stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
          duration: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        console.log("[Diagnose] Process error:", err.message);
        resolve({
          success: false,
          error: err.message,
          duration: Date.now() - startTime,
        });
      });
    });

    results.push({ step: "simple prompt test", ...promptResult });
    console.log("[Diagnose] Prompt test result:", promptResult);
  }

  return {
    claudePath,
    platform: process.platform,
    results,
    allPassed: results.every((r) => r.success),
  };
});

// タスクの実行状態を取得
app.get(
  "/tasks/:id/execution-status",
  async ({ params }: { params: { id: string } }) => {
    try {
      const taskId = parseInt(params.id);

      // 最新のセッションと実行を取得
      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          agentSessions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              agentExecutions: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      if (!config || !config.agentSessions[0]) {
        return { status: "none", message: "実行履歴がありません" };
      }

      const latestSession = config.agentSessions[0];
      const latestExecution = latestSession.agentExecutions[0];

      // 質問待ち状態の情報
      const isWaitingForInput = latestExecution?.status === "waiting_for_input";
      const questionText = (latestExecution as any)?.question || null;
      // DBからquestionTypeを取得（保存されていない場合はパターンマッチングにフォールバック）
      let questionType: "tool_call" | "pattern_match" | "none" =
        ((latestExecution as any)?.questionType as
          | "tool_call"
          | "pattern_match"
          | "none") || "none";

      // questionTypeがDBに保存されていない場合のフォールバック（後方互換性）
      if (isWaitingForInput && questionText && questionType === "none") {
        questionType = "pattern_match";
      }

      return {
        sessionId: latestSession.id,
        sessionStatus: latestSession.status,
        executionId: latestExecution?.id,
        executionStatus: latestExecution?.status,
        output: latestExecution?.output,
        errorMessage: latestExecution?.errorMessage,
        startedAt: latestExecution?.startedAt,
        completedAt: latestExecution?.completedAt,
        // 質問待ち状態の情報
        waitingForInput: isWaitingForInput,
        question: questionText,
        questionType, // 質問の検出方法（tool_call, pattern_match, none）
      };
    } catch (error) {
      console.error("[execution-status] Error fetching status:", error);
      return { status: "error", message: "状態の取得中にエラーが発生しました" };
    }
  },
);

// エージェントへの応答（質問への回答）
app.post(
  "/tasks/:id/agent-respond",
  async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { response: string };
  }) => {
    const taskId = parseInt(params.id);
    const { response } = body;

    if (!response?.trim()) {
      return { error: "Response is required" };
    }

    // タスクの設定を取得
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
      include: {
        task: { include: { theme: true } },
        agentSessions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            agentExecutions: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!config || !config.agentSessions[0]) {
      return { error: "No active session found" };
    }

    const session = config.agentSessions[0];
    const latestExecution = session.agentExecutions[0];

    // waiting_for_input 状態のみ許可
    if (!latestExecution || latestExecution.status !== "waiting_for_input") {
      return {
        error: "No execution waiting for input",
        currentStatus: latestExecution?.status,
      };
    }

    const workingDirectory =
      config.task.theme?.workingDirectory || process.cwd();

    try {
      // オーケストレーターで継続実行（既存の実行を再開、--continue フラグを使用）
      orchestrator
        .executeContinuation(latestExecution.id, response.trim(), {
          timeout: 900000,
        })
        .then(async (result) => {
          // 成功かつ質問待ちでない場合のみ、差分を確認してレビュー依頼を作成
          if (result.success && !result.waitingForInput) {
            const diff = await orchestrator.getFullGitDiff(workingDirectory);
            if (diff && diff !== "No changes detected") {
              // コードレビュー承認リクエストを作成
              const structuredDiff =
                await orchestrator.getDiff(workingDirectory);
              const implementationSummary =
                result.output || "実装が完了しました。";

              const approvalRequest = await prisma.approvalRequest.create({
                data: {
                  configId: config.id,
                  requestType: "code_review",
                  title: `「${config.task.title}」のコードレビュー`,
                  description: implementationSummary,
                  proposedChanges: toJsonString({
                    taskId,
                    sessionId: session.id,
                    workingDirectory,
                    diff,
                    structuredDiff,
                    implementationSummary,
                    executionTimeMs: result.executionTimeMs,
                  }),
                  estimatedChanges: toJsonString({
                    diff,
                    filesChanged: structuredDiff.length,
                    summary: implementationSummary.substring(0, 500),
                  }),
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
              });

              await prisma.notification.create({
                data: {
                  type: "pr_review_requested",
                  title: "コードレビュー依頼",
                  message: `「${config.task.title}」の実装が完了しました。レビューをお願いします。`,
                  link: `/approvals/${approvalRequest.id}`,
                },
              });
            }
          }
        })
        .catch(console.error);

      return {
        success: true,
        message: "Response sent successfully",
        executionId: latestExecution.id,
      };
    } catch (error: any) {
      console.error("Agent respond failed:", error);
      return { error: error.message || "Failed to send response" };
    }
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

// タスクの実行を停止
app.post(
  "/tasks/:id/stop-execution",
  async ({ params }: { params: { id: string } }) => {
    const taskId = parseInt(params.id);

    // タスクの最新の実行中セッションを取得
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
      include: {
        agentSessions: {
          where: {
            status: { in: ["running", "pending"] },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!config || config.agentSessions.length === 0) {
      // セッションがない場合でも、実行中の実行レコードを直接停止
      const runningExecution = await prisma.agentExecution.findFirst({
        where: {
          session: {
            config: {
              taskId,
            },
          },
          status: { in: ["running", "pending", "waiting_for_input"] },
        },
        orderBy: { createdAt: "desc" },
      });

      if (runningExecution) {
        // オーケストレーターから停止を試みる
        try {
          await orchestrator.stopExecution(runningExecution.id);
        } catch (e) {
          // オーケストレーターで停止できない場合は直接DBを更新
          await prisma.agentExecution.update({
            where: { id: runningExecution.id },
            data: {
              status: "cancelled",
              completedAt: new Date(),
              errorMessage: "Manually stopped",
            },
          });
        }

        return { success: true, message: "Execution stopped" };
      }

      return { success: false, message: "No running execution found" };
    }

    const session = config.agentSessions[0];

    // セッションの全実行を停止
    const executions = orchestrator.getSessionExecutions(session.id);
    for (const execution of executions) {
      await orchestrator.stopExecution(execution.executionId);
    }

    // オーケストレーターに登録されていない実行も直接停止
    const pendingExecutions = await prisma.agentExecution.findMany({
      where: {
        sessionId: session.id,
        status: { in: ["running", "pending", "waiting_for_input"] },
      },
    });

    for (const execution of pendingExecutions) {
      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          errorMessage: "Manually stopped",
        },
      });
    }

    // セッションを更新
    await prisma.agentSession.update({
      where: { id: session.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Manually stopped",
      },
    });

    return { success: true, sessionId: session.id };
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
      "Access-Control-Allow-Origin": "*",
    };

    console.log(`[SSE] Client connecting to channel: ${channel}`);

    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            write: (data: string) => {
              try {
                controller.enqueue(new TextEncoder().encode(data));
              } catch (e) {
                console.error(`[SSE] Error writing to client:`, e);
              }
            },
          };

          const clientId = realtimeService.registerClient(client, [channel]);
          console.log(
            `[SSE] Client ${clientId} registered for channel: ${channel}`,
          );

          // 接続確認イベントを即座に送信
          client.write(
            `event: connected\ndata: ${JSON.stringify({ channel, clientId })}\n\n`,
          );

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
          "Access-Control-Allow-Origin": "*",
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

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database for Tauri/SQLite builds
    if (isTauriBuild) {
      console.log("🔧 Initializing SQLite database for Tauri...");
      await initializeDatabase(prisma);
    }

    app.listen(3001);
    console.log("🚀 Rapitas backend running on http://localhost:3001");
    if (isTauriBuild) {
      console.log("📦 Running in Tauri mode with SQLite database");
    }
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

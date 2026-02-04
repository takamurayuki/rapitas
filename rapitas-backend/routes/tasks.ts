/**
 * Tasks API Routes
 * Core task CRUD operations
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";

export const tasksRoutes = new Elysia({ prefix: "/tasks" })
  // Search task titles for autocomplete
  .get(
    "/search",
    async ({ query }: {
      query: { q?: string; limit?: string; themeId?: string; projectId?: string }
    }) => {
      const { q, limit, themeId, projectId } = query;
      const searchQuery = q?.trim() ?? "";
      const resultLimit = Math.min(parseInt(limit ?? "10"), 20);

      if (!searchQuery) {
        return [];
      }

      return await prisma.task.findMany({
        where: {
          parentId: null,
          title: {
            contains: searchQuery,
          },
          ...(themeId && { themeId: parseInt(themeId) }),
          ...(projectId && { projectId: parseInt(projectId) }),
        },
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          theme: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: resultLimit,
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
      }),
    }
  )

  // Get all tasks
  .get(
    "/",
    async ({ query }: {
      query: { projectId?: string; milestoneId?: string; priority?: string }
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
    }
  )

  // Get task by ID
  .get("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.task.findUnique({
      where: { id },
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
  })

  // Create task
  .post(
    "/",
    async ({ body }: { body: {
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
      isDeveloperMode?: boolean;
      isAiTaskAnalysis?: boolean;
    }}) => {
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

      // サブタスク作成時の重複チェック（ガード節）
      if (parentId) {
        const existingSubtask = await prisma.task.findFirst({
          where: {
            parentId,
            title: {
              equals: title,
              mode: 'insensitive', // 大文字小文字を無視
            },
          },
        });

        if (existingSubtask) {
          console.log(`[tasks] Duplicate subtask prevented: "${title}" already exists for parent ${parentId}`);
          // 既存のサブタスクを返す（重複作成を防止）
          return await prisma.task.findUnique({
            where: { id: existingSubtask.id },
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
        }
      }

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

      // Label associations
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
    }
  )

  // Update task
  .patch(
    "/:id",
    async ({ params, body }: {
      params: { id: string };
      body: {
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
      }
    }) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError("無効なIDです");
      }

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
      } = body;

      // Record streak on task completion
      if (status === "done") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await prisma.studyStreak.upsert({
          where: { date: today },
          update: { tasksCompleted: { increment: 1 } },
          create: { date: today, studyMinutes: 0, tasksCompleted: 1 },
        });

        // Check for achievement unlocks (fire and forget)
        fetch("http://localhost:3001/achievements/check", { method: "POST" }).catch(() => {});
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

      // Update labels if provided
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
    }
  )

  // Delete task
  .delete("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.task.delete({
      where: { id },
    });
  })

  // 重複サブタスクを削除（特定のタスク配下）
  .post("/:id/cleanup-duplicates", async ({ params }: { params: { id: string } }) => {
    const parentId = parseInt(params.id);
    if (isNaN(parentId)) {
      throw new ValidationError("無効なIDです");
    }

    // 親タスクの存在確認
    const parentTask = await prisma.task.findUnique({
      where: { id: parentId },
    });

    if (!parentTask) {
      throw new ValidationError("タスクが見つかりません");
    }

    // サブタスクを取得
    const subtasks = await prisma.task.findMany({
      where: { parentId },
      orderBy: { createdAt: "asc" }, // 古い順（最初に作成されたものを残す）
    });

    // タイトルでグループ化して重複を検出
    const titleMap = new Map<string, typeof subtasks>();
    for (const subtask of subtasks) {
      const normalizedTitle = subtask.title.toLowerCase().trim();
      if (!titleMap.has(normalizedTitle)) {
        titleMap.set(normalizedTitle, []);
      }
      titleMap.get(normalizedTitle)!.push(subtask);
    }

    // 重複を削除（最初の1つを残す）
    const deletedIds: number[] = [];
    for (const [title, duplicates] of titleMap) {
      if (duplicates.length > 1) {
        // 最初の1つを残して残りを削除
        const toDelete = duplicates.slice(1);
        for (const subtask of toDelete) {
          await prisma.task.delete({
            where: { id: subtask.id },
          });
          deletedIds.push(subtask.id);
          console.log(`[tasks] Deleted duplicate subtask: "${subtask.title}" (id: ${subtask.id})`);
        }
      }
    }

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      message: deletedIds.length > 0
        ? `${deletedIds.length}件の重複サブタスクを削除しました`
        : "重複サブタスクはありませんでした",
    };
  })

  // 全タスクの重複サブタスクを一括削除
  .post("/cleanup-all-duplicates", async () => {
    // 親タスクを持つサブタスクをすべて取得
    const allSubtasks = await prisma.task.findMany({
      where: {
        parentId: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });

    // 親タスクごとにグループ化
    const parentMap = new Map<number, typeof allSubtasks>();
    for (const subtask of allSubtasks) {
      const parentId = subtask.parentId!;
      if (!parentMap.has(parentId)) {
        parentMap.set(parentId, []);
      }
      parentMap.get(parentId)!.push(subtask);
    }

    // 各親タスク配下で重複を削除
    const deletedIds: number[] = [];
    const affectedParents: number[] = [];

    for (const [parentId, subtasks] of parentMap) {
      const titleMap = new Map<string, typeof subtasks>();
      for (const subtask of subtasks) {
        const normalizedTitle = subtask.title.toLowerCase().trim();
        if (!titleMap.has(normalizedTitle)) {
          titleMap.set(normalizedTitle, []);
        }
        titleMap.get(normalizedTitle)!.push(subtask);
      }

      let parentHadDuplicates = false;
      for (const [title, duplicates] of titleMap) {
        if (duplicates.length > 1) {
          parentHadDuplicates = true;
          const toDelete = duplicates.slice(1);
          for (const subtask of toDelete) {
            await prisma.task.delete({
              where: { id: subtask.id },
            });
            deletedIds.push(subtask.id);
            console.log(`[tasks] Deleted duplicate subtask: "${subtask.title}" (id: ${subtask.id}, parent: ${parentId})`);
          }
        }
      }

      if (parentHadDuplicates) {
        affectedParents.push(parentId);
      }
    }

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      affectedParentCount: affectedParents.length,
      affectedParentIds: affectedParents,
      message: deletedIds.length > 0
        ? `${affectedParents.length}件のタスクから${deletedIds.length}件の重複サブタスクを削除しました`
        : "重複サブタスクはありませんでした",
    };
  });

/**
 * Tasks API Routes
 * Core task CRUD operations
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";
import { sendAIMessage, getDefaultProvider, isAnyApiKeyConfigured, type AIMessage } from "../utils/ai-client";

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

  // Get task suggestions based on past tasks for a theme (frequency-based fallback)
  .get(
    "/suggestions",
    async ({ query }: {
      query: { themeId?: string; limit?: string }
    }) => {
      const { themeId, limit } = query;
      const resultLimit = Math.min(parseInt(limit ?? "10"), 20);

      if (!themeId) {
        return { suggestions: [] };
      }

      const parsedThemeId = parseInt(themeId);

      // Get completed tasks for this theme (most recent first)
      const completedTasks = await prisma.task.findMany({
        where: {
          themeId: parsedThemeId,
          parentId: null,
          status: "done",
        },
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          estimatedHours: true,
          completedAt: true,
          taskLabels: {
            include: { label: true },
          },
        },
        orderBy: { completedAt: "desc" },
        take: 50,
      });

      // Get in-progress / todo tasks to avoid suggesting duplicates
      const existingTasks = await prisma.task.findMany({
        where: {
          themeId: parsedThemeId,
          parentId: null,
          status: { in: ["todo", "in-progress"] },
        },
        select: { title: true },
      });

      const existingTitles = new Set(
        existingTasks.map((t: { title: string }) => t.title.toLowerCase().trim())
      );

      // Count title frequency to find recurring patterns
      const titleFrequency = new Map<string, {
        title: string;
        count: number;
        lastPriority: string;
        lastEstimatedHours: number | null;
        lastDescription: string | null;
        lastCompletedAt: Date | null;
        labelIds: number[];
      }>();

      for (const task of completedTasks) {
        const normalized = task.title.toLowerCase().trim();
        if (existingTitles.has(normalized)) continue;

        const existing = titleFrequency.get(normalized);
        if (existing) {
          existing.count++;
        } else {
          titleFrequency.set(normalized, {
            title: task.title,
            count: 1,
            lastPriority: task.priority,
            lastEstimatedHours: task.estimatedHours,
            lastDescription: task.description,
            lastCompletedAt: task.completedAt,
            labelIds: task.taskLabels?.map((tl: { labelId: number }) => tl.labelId) ?? [],
          });
        }
      }

      // Sort: recurring tasks first (by frequency), then by recency
      const suggestions = Array.from(titleFrequency.values())
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          const aTime = a.lastCompletedAt?.getTime() ?? 0;
          const bTime = b.lastCompletedAt?.getTime() ?? 0;
          return bTime - aTime;
        })
        .slice(0, resultLimit)
        .map((item) => ({
          title: item.title,
          frequency: item.count,
          priority: item.lastPriority,
          estimatedHours: item.lastEstimatedHours,
          description: item.lastDescription,
          labelIds: item.labelIds,
        }));

      return { suggestions };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // AI-powered task suggestions: analyze past tasks and suggest new ones
  .get(
    "/suggestions/ai",
    async ({ query }: {
      query: { themeId?: string; limit?: string }
    }) => {
      const { themeId, limit } = query;
      const resultLimit = Math.min(parseInt(limit ?? "5"), 10);

      if (!themeId) {
        return { suggestions: [], source: "none" };
      }

      const parsedThemeId = parseInt(themeId);

      // Check if AI is available
      const aiAvailable = await isAnyApiKeyConfigured();

      // Get theme info
      const theme = await prisma.theme.findUnique({
        where: { id: parsedThemeId },
        select: { id: true, name: true, description: true },
      });

      if (!theme) {
        return { suggestions: [], source: "none" };
      }

      // Get completed tasks for analysis
      const completedTasks = await prisma.task.findMany({
        where: {
          themeId: parsedThemeId,
          parentId: null,
          status: "done",
        },
        select: {
          title: true,
          description: true,
          priority: true,
          estimatedHours: true,
          completedAt: true,
          taskLabels: {
            include: { label: true },
          },
        },
        orderBy: { completedAt: "desc" },
        take: 30,
      });

      // Get existing active tasks to avoid duplicates
      const existingTasks = await prisma.task.findMany({
        where: {
          themeId: parsedThemeId,
          parentId: null,
          status: { in: ["todo", "in-progress"] },
        },
        select: { title: true },
      });

      const existingTitles = existingTasks.map((t: { title: string }) => t.title);

      if (!aiAvailable || completedTasks.length < 2) {
        // Fallback: return empty if no AI or insufficient data
        return { suggestions: [], source: "insufficient_data" };
      }

      // Build a summary of past tasks for the AI
      const taskSummary = completedTasks.map((t: typeof completedTasks[number], i: number) => {
        const labels = t.taskLabels?.map((tl: { label: { name: string } }) => tl.label.name).join(", ") || "なし";
        return `${i + 1}. "${t.title}" (優先度: ${t.priority}, 見積: ${t.estimatedHours ?? "未設定"}h, ラベル: ${labels})${t.description ? ` - ${t.description.slice(0, 80)}` : ""}`;
      }).join("\n");

      const existingTaskList = existingTitles.length > 0
        ? `\n\n## 現在進行中・未着手のタスク（これらと重複しないこと）\n${existingTitles.map((t: string) => `- ${t}`).join("\n")}`
        : "";

      const systemPrompt = `あなたはタスク管理AIアシスタントです。ユーザーの過去のタスク履歴を分析し、次に取り組むべきタスクを提案します。

以下の観点で分析してください:
1. **繰り返しパターン**: 定期的に行われているタスクで、次回実行が必要なもの
2. **関連タスク**: 完了済みタスクの延長線上にある発展的なタスク
3. **未着手の可能性**: 過去のタスクから推測される、まだ着手していない関連作業
4. **改善・最適化**: 過去のタスクを踏まえた改善や最適化のタスク

提案するタスクは具体的かつ実行可能なものにしてください。

回答は必ず以下のJSON形式で返してください:
{
  "analysis": "過去のタスク傾向の簡潔な分析（2-3文）",
  "suggestions": [
    {
      "title": "提案タスクのタイトル（簡潔に）",
      "description": "タスクの説明（1-2文）",
      "priority": "low" | "medium" | "high" | "urgent",
      "estimatedHours": 数値またはnull,
      "reason": "この提案の根拠（どの過去タスクから推測したか）",
      "category": "recurring" | "extension" | "improvement" | "new"
    }
  ]
}`;

      const userPrompt = `## テーマ: ${theme.name}${theme.description ? ` (${theme.description})` : ""}

## 過去の完了タスク（新しい順）
${taskSummary}
${existingTaskList}

上記の過去タスクを分析し、次に取り組むべきタスクを${resultLimit}件提案してください。
既存の進行中・未着手タスクと重複しない提案をお願いします。`;

      try {
        const provider = await getDefaultProvider();
        const messages: AIMessage[] = [
          { role: "user", content: userPrompt },
        ];

        const response = await sendAIMessage({
          provider,
          messages,
          systemPrompt,
          maxTokens: 2048,
        });

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("[tasks/suggestions/ai] Failed to parse AI response");
          return { suggestions: [], source: "ai_error" };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        const suggestions = (parsed.suggestions || []).slice(0, resultLimit).map((s: {
          title: string;
          description?: string;
          priority?: string;
          estimatedHours?: number | null;
          reason?: string;
          category?: string;
        }) => ({
          title: s.title,
          description: s.description || null,
          priority: s.priority || "medium",
          estimatedHours: s.estimatedHours || null,
          reason: s.reason || null,
          category: s.category || "new",
          labelIds: [],
          frequency: 0,
        }));

        // Save suggestions to DB cache
        try {
          if (prisma.taskSuggestionCache) {
            // Delete old cache for this theme
            await prisma.taskSuggestionCache.deleteMany({
              where: { themeId: parsedThemeId },
            });
            // Save new suggestions
            if (suggestions.length > 0) {
              await prisma.taskSuggestionCache.createMany({
                data: suggestions.map((s: {
                  title: string;
                  description: string | null;
                  priority: string;
                  estimatedHours: number | null;
                  reason: string | null;
                  category: string;
                  labelIds: number[];
                }, idx: number) => ({
                  themeId: parsedThemeId,
                  title: s.title,
                  description: s.description,
                  priority: s.priority,
                  estimatedHours: s.estimatedHours,
                  reason: s.reason,
                  category: s.category,
                  labelIds: JSON.stringify(s.labelIds),
                  analysis: idx === 0 ? (parsed.analysis || null) : null,
                })),
              });
            }
          } else {
            console.warn("[tasks/suggestions/ai] taskSuggestionCache model not available - run prisma generate");
          }
        } catch (cacheError) {
          console.error("[tasks/suggestions/ai] Failed to cache suggestions:", cacheError);
        }

        return {
          suggestions,
          analysis: parsed.analysis || null,
          source: "ai",
          tokensUsed: response.tokensUsed,
        };
      } catch (error) {
        console.error("[tasks/suggestions/ai] AI suggestion failed:", error);
        return { suggestions: [], source: "ai_error" };
      }
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // Get cached AI suggestions for a theme
  .get(
    "/suggestions/ai/cache",
    async ({ query }: {
      query: { themeId?: string }
    }) => {
      const { themeId } = query;

      if (!themeId) {
        return { suggestions: [], analysis: null, source: "none" };
      }

      const parsedThemeId = parseInt(themeId);

      if (!prisma.taskSuggestionCache) {
        console.warn("[tasks/suggestions/ai/cache] taskSuggestionCache model not available - run prisma generate");
        return { suggestions: [], analysis: null, source: "none" };
      }

      const cached = await prisma.taskSuggestionCache.findMany({
        where: { themeId: parsedThemeId },
        orderBy: { id: "asc" },
      });

      if (cached.length === 0) {
        return { suggestions: [], analysis: null, source: "none" };
      }

      const analysis = cached.find((c: { analysis: string | null }) => c.analysis)?.analysis || null;

      const suggestions = cached.map((c: {
        title: string;
        description: string | null;
        priority: string;
        estimatedHours: number | null;
        reason: string | null;
        category: string;
        labelIds: string;
      }) => ({
        title: c.title,
        description: c.description,
        priority: c.priority,
        estimatedHours: c.estimatedHours,
        reason: c.reason,
        category: c.category,
        labelIds: JSON.parse(c.labelIds),
        frequency: 0,
      }));

      return { suggestions, analysis, source: "cache" };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
      }),
    }
  )

  // Delete cached suggestions for a theme
  .delete(
    "/suggestions/ai/cache",
    async ({ query }: {
      query: { themeId?: string }
    }) => {
      const { themeId } = query;

      if (!themeId) {
        return { success: false, message: "themeId is required" };
      }

      const parsedThemeId = parseInt(themeId);

      if (!prisma.taskSuggestionCache) {
        console.warn("[tasks/suggestions/ai/cache] taskSuggestionCache model not available - run prisma generate");
        return { success: false, message: "taskSuggestionCache model not available" };
      }

      const result = await prisma.taskSuggestionCache.deleteMany({
        where: { themeId: parsedThemeId },
      });

      return {
        success: true,
        deletedCount: result.count,
      };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
      }),
    }
  )

  // Get all tasks (supports incremental fetch via `since` param)
  .get(
    "/",
    async ({ query }: {
      query: { projectId?: string; milestoneId?: string; priority?: string; since?: string }
    }) => {
      const { projectId, milestoneId, priority, since } = query;

      const baseWhere = {
        parentId: null,
        ...(projectId && { projectId: parseInt(projectId) }),
        ...(milestoneId && { milestoneId: parseInt(milestoneId) }),
        ...(priority && { priority }),
      };

      // If `since` is provided, return only tasks updated after that timestamp + total count
      if (since) {
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          throw new ValidationError("Invalid `since` parameter");
        }

        const [updated, totalCount] = await Promise.all([
          prisma.task.findMany({
            where: {
              ...baseWhere,
              updatedAt: { gt: sinceDate },
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
          }),
          prisma.task.count({ where: baseWhere }),
        ]);

        return {
          tasks: updated,
          totalCount,
          since: sinceDate.toISOString(),
          incremental: true,
        };
      }

      // Full fetch (no `since`)
      const tasks = await prisma.task.findMany({
        where: baseWhere,
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

      return tasks;
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

      // サブタスク作成時はトランザクションで重複チェックと作成を原子的に実行
      if (parentId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await prisma.$transaction(async (tx: any) => {
          // トランザクション内で重複チェック
          const existingSubtask = await tx.task.findFirst({
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
            return await tx.task.findUnique({
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

          // トランザクション内でサブタスクを作成
          const task = await tx.task.create({
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
              parentId,
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
            await tx.taskLabel.createMany({
              data: labelIds.map((labelId: number) => ({
                taskId: task.id,
                labelId,
              })),
            });
          }

          return await tx.task.findUnique({
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
        }, {
          isolationLevel: 'Serializable', // 競合を防ぐための分離レベル
        });

        return result;
      }

      // 親タスク作成（parentIdがない場合）
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
        fetch(`http://localhost:${process.env.PORT || "3001"}/achievements/check`, { method: "POST" }).catch(() => {});
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
  })

  // サブタスクの一括削除（特定のタスク配下のすべてのサブタスクを削除）
  .delete("/:id/subtasks", async ({ params }: { params: { id: string } }) => {
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

    // サブタスクを取得して削除数を確認
    const subtasks = await prisma.task.findMany({
      where: { parentId },
      select: { id: true },
    });

    const deletedCount = subtasks.length;

    // 一括削除
    await prisma.task.deleteMany({
      where: { parentId },
    });

    console.log(`[tasks] Deleted all ${deletedCount} subtasks for parent task ${parentId}`);

    return {
      success: true,
      deletedCount,
      message: deletedCount > 0
        ? `${deletedCount}件のサブタスクを削除しました`
        : "削除するサブタスクがありませんでした",
    };
  })

  // サブタスクの選択削除（指定されたIDのサブタスクを一括削除）
  .post(
    "/:id/subtasks/delete-selected",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { subtaskIds: number[] };
    }) => {
      const parentId = parseInt(params.id);
      if (isNaN(parentId)) {
        throw new ValidationError("無効なIDです");
      }

      const { subtaskIds } = body;

      if (!subtaskIds || subtaskIds.length === 0) {
        throw new ValidationError("削除するサブタスクが指定されていません");
      }

      // 親タスクの存在確認
      const parentTask = await prisma.task.findUnique({
        where: { id: parentId },
      });

      if (!parentTask) {
        throw new ValidationError("タスクが見つかりません");
      }

      // 指定されたサブタスクが実際にこの親タスクに属しているか確認
      const validSubtasks = await prisma.task.findMany({
        where: {
          id: { in: subtaskIds },
          parentId,
        },
        select: { id: true },
      });

      const validIds = validSubtasks.map((s: { id: number }) => s.id);
      const invalidIds = subtaskIds.filter((id) => !validIds.includes(id));

      if (invalidIds.length > 0) {
        console.warn(`[tasks] Some subtask IDs are invalid or don't belong to parent ${parentId}: ${invalidIds.join(", ")}`);
      }

      // 有効なサブタスクのみ削除
      const deleteResult = await prisma.task.deleteMany({
        where: {
          id: { in: validIds },
          parentId,
        },
      });

      console.log(`[tasks] Deleted ${deleteResult.count} selected subtasks for parent task ${parentId}`);

      return {
        success: true,
        deletedCount: deleteResult.count,
        deletedIds: validIds,
        invalidIds,
        message: deleteResult.count > 0
          ? `${deleteResult.count}件のサブタスクを削除しました`
          : "削除するサブタスクがありませんでした",
      };
    },
    {
      body: t.Object({
        subtaskIds: t.Array(t.Number()),
      }),
    }
  );

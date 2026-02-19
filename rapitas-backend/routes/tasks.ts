/**
 * Tasks API Routes
 * Core task CRUD operations
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { AppError, ValidationError } from "../middleware/error-handler";
import { sendAIMessage, getDefaultProvider, isAnyApiKeyConfigured, type AIMessage } from "../utils/ai-client";
import { UserBehaviorService } from "../src/services/userBehaviorService";

export const tasksRoutes = new Elysia({ prefix: "/tasks" })
  // Search task titles for autocomplete
  .get(
    "/search", async ({  query  }: any) => {
      const { q, limit, themeId, projectId } = query as any;
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
    "/suggestions", async ({  query  }: any) => {
      const { themeId, limit } = query as any;
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
    "/suggestions/ai", async ({  query  }: any) => {
      const { themeId, limit } = query as any;
      const resultLimit = Math.min(parseInt(limit ?? "5"), 10);

      console.log("[tasks/suggestions/ai] Request received - themeId:", themeId, "limit:", resultLimit);

      if (!themeId) {
        return { suggestions: [], source: "none" };
      }

      const parsedThemeId = parseInt(themeId);

      // Check if AI is available
      const aiAvailable = await isAnyApiKeyConfigured();
      console.log("[tasks/suggestions/ai] AI available:", aiAvailable);

      // Get theme info
      const theme = await prisma.theme.findUnique({
        where: { id: parsedThemeId },
        select: { id: true, name: true, description: true },
      });

      if (!theme) {
        console.log("[tasks/suggestions/ai] Theme not found:", parsedThemeId);
        return { suggestions: [], source: "none" };
      }

      console.log("[tasks/suggestions/ai] Theme found:", theme.name);

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
          actualHours: true,
          completedAt: true,
          taskLabels: {
            include: { label: true },
          },
        },
        orderBy: { completedAt: "desc" },
        take: 30,
      });

      console.log("[tasks/suggestions/ai] Completed tasks found:", completedTasks.length);

      // ユーザーの行動パターンを取得
      const taskPatterns = await prisma.taskPattern.findMany({
        where: {
          themeId: parsedThemeId,
          frequency: { gte: 2 }, // 2回以上実行されたタスク
        },
        orderBy: [
          { frequency: "desc" },
          { lastOccurrence: "desc" }
        ],
        take: 10,
      });

      console.log("[tasks/suggestions/ai] Task patterns found:", taskPatterns.length);

      // ユーザーの行動サマリーを取得（最新の週次・月次データ）
      const behaviorSummary = await prisma.userBehaviorSummary.findFirst({
        where: {
          themeId: parsedThemeId,
          periodType: { in: ["weekly", "monthly"] }
        },
        orderBy: { periodEnd: "desc" }
      });

      console.log("[tasks/suggestions/ai] Behavior summary found:", behaviorSummary ? "yes" : "no");

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
      console.log("[tasks/suggestions/ai] Existing active tasks:", existingTitles.length);

      if (!aiAvailable) {
        console.log("[tasks/suggestions/ai] AI not available");
        return { suggestions: [], source: "insufficient_data" };
      }

      // AIを使用する場合は、完了タスクが0件でもテーマ情報から提案を生成
      if (completedTasks.length === 0) {
        console.log("[tasks/suggestions/ai] No completed tasks, generating initial suggestions based on theme");
      }

      // Build a summary of past tasks for the AI
      const taskSummary = completedTasks.length > 0
        ? completedTasks.map((t: typeof completedTasks[number], i: number) => {
            const labels = t.taskLabels?.map((tl: { label: { name: string } }) => tl.label.name).join(", ") || "なし";
            const accuracy = t.estimatedHours && t.actualHours
              ? `見積精度: ${Math.round((t.actualHours / t.estimatedHours) * 100)}%`
              : "";
            return `${i + 1}. "${t.title}" (優先度: ${t.priority}, 見積: ${t.estimatedHours ?? "未設定"}h, 実績: ${t.actualHours ?? "未記録"}h ${accuracy}, ラベル: ${labels})${t.description ? ` - ${t.description.slice(0, 80)}` : ""}`;
          }).join("\n")
        : "（まだ完了タスクがありません）";

      // 行動パターンのサマリーを作成
      const patternSummary = taskPatterns.length > 0
        ? "\n\n【頻繁に実行されるタスクパターン】\n" + taskPatterns.map((p: typeof taskPatterns[number], i: number) => {
            const labelIds = p.labelIds ? JSON.parse(p.labelIds) : [];
            const avgTimeToStart = p.averageTimeToStart ? `平均開始時間: ${Math.round(p.averageTimeToStart)}時間後` : "";
            const avgTimeToComplete = p.averageTimeToComplete ? `平均完了時間: ${Math.round(p.averageTimeToComplete)}時間` : "";
            return `${i + 1}. "${p.taskTitle}" (頻度: ${p.frequency}回, 優先度: ${p.priority}, ${avgTimeToStart}, ${avgTimeToComplete})`;
          }).join("\n")
        : "";

      // ユーザーの好みと傾向を分析
      const userPreferences = behaviorSummary ? {
        preferredTimeOfDay: behaviorSummary.preferredTimeOfDay,
        mostUsedLabels: behaviorSummary.mostUsedLabels ? JSON.parse(behaviorSummary.mostUsedLabels) : [],
        taskPriorities: behaviorSummary.taskPriorities ? JSON.parse(behaviorSummary.taskPriorities) : {},
        averageCompletionTime: behaviorSummary.averageCompletionTime,
      } : null;

      const preferenceSummary = userPreferences
        ? `\n\n【ユーザーの作業傾向】
- 好みの作業時間帯: ${userPreferences.preferredTimeOfDay || "不明"}
- 平均完了時間: ${userPreferences.averageCompletionTime ? `${Math.round(userPreferences.averageCompletionTime)}時間` : "不明"}
- よく使うラベル: ${userPreferences.mostUsedLabels.slice(0, 3).map((l: any) => `${l.labelId}`).join(", ") || "なし"}
- 優先度の傾向: ${Object.entries(userPreferences.taskPriorities).map(([p, c]) => `${p}: ${c}`).join(", ") || "不明"}`
        : "";

      const existingTaskList = existingTitles.length > 0
        ? `\n\n## 現在進行中・未着手のタスク（これらと重複しないこと）\n${existingTitles.map((t: string) => `- ${t}`).join("\n")}`
        : "";

      const systemPrompt = `あなたはタスク管理AIアシスタントです。テーマの情報、過去のタスク履歴、そしてユーザーの行動パターンを分析し、パーソナライズされた次のタスクを提案します。

**重要**: 提案するタスクは必ずSMART目標の原則に従ってください:
- **Specific（具体的）**: 何を、どこで、どのように行うか明確にする
- **Measurable（測定可能）**: 完了基準を数値や具体的な成果物で定義
- **Achievable（達成可能）**: 実現可能な範囲で設定（ユーザーの実績精度を考慮）
- **Relevant（関連性）**: テーマとの関連性が明確
- **Time-bound（期限）**: ユーザーの過去の実績に基づいた現実的な推定時間

ユーザーの行動パターンを考慮してください:
- 頻繁に実行されるタスクパターンを優先
- ユーザーの好みの作業時間帯に合わせた難易度
- よく使うラベルや優先度の傾向を反映
- 過去の見積精度を考慮した現実的な時間見積もり

過去のタスクがある場合は以下の観点で分析してください:
1. **繰り返しパターン**: 頻度の高いタスクの具体的な次回実行内容（例: "第3章の問題集50問を解く"）
2. **関連タスク**: 完了済みタスクの発展版（例: "基本実装完了→パフォーマンステストで応答時間を20%改善"）
3. **未着手作業**: 過去のパターンから推測される具体的作業（例: "エラーハンドリング実装: 5種類の例外処理を追加"）
4. **改善・最適化**: 測定可能な改善目標（例: "ビルド時間を現在の3分から2分に短縮"）

過去のタスクがない場合は、テーマから具体的なタスクを推測:
1. **初期セットアップ**: 具体的な環境構築手順（例: "Next.js プロジェクト作成と5つの必須パッケージ導入"）
2. **基本的な実装**: 明確な成果物（例: "ユーザー認証機能: ログイン・ログアウト・パスワードリセットの3画面実装"）
3. **ドキュメント化**: 具体的な文書作成（例: "README.md作成: インストール手順、使用方法、API仕様の3セクション"）
4. **テスト・検証**: 定量的なテスト（例: "単体テスト20件作成、カバレッジ80%達成"）

回答は必ず以下のJSON形式で返してください:
{
  "analysis": "テーマの特徴や過去のタスク傾向の簡潔な分析（2-3文）",
  "suggestions": [
    {
      "title": "提案タスクのタイトル（動詞＋具体的な対象＋数量/範囲）",
      "description": "タスクの詳細説明（何を・どのように・どこまで）",
      "priority": "low" | "medium" | "high" | "urgent",
      "estimatedHours": 数値（必須、0.5刻み）,
      "reason": "この提案の根拠（過去のデータや論理的な理由）",
      "category": "recurring" | "extension" | "improvement" | "new",
      "completionCriteria": "完了条件（箇条書きで2-3項目）",
      "measurableOutcome": "測定可能な成果（数値目標や具体的な成果物）",
      "dependencies": "前提条件や必要なもの（ある場合）",
      "suggestedApproach": "推奨される実施方法（ステップや手順）"
    }
  ]
}`;

      const userPrompt = completedTasks.length > 0
        ? `## テーマ: ${theme.name}${theme.description ? ` (${theme.description})` : ""}

## 過去の完了タスク（新しい順）
${taskSummary}
${patternSummary}
${preferenceSummary}
${existingTaskList}

上記の過去タスクとユーザーの行動パターンを分析し、パーソナライズされた次に取り組むべきタスクを${resultLimit}件提案してください。
既存の進行中・未着手タスクと重複しない提案をお願いします。`
        : `## テーマ: ${theme.name}${theme.description ? ` (${theme.description})` : ""}

このテーマに関するタスクはまだありません。
${existingTaskList}

テーマの内容から推測して、最初に取り組むべきタスクを${resultLimit}件提案してください。
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
          completionCriteria?: string;
          measurableOutcome?: string;
          dependencies?: string;
          suggestedApproach?: string;
        }) => ({
          title: s.title,
          description: s.description || null,
          priority: s.priority || "medium",
          estimatedHours: s.estimatedHours || null,
          reason: s.reason || null,
          category: s.category || "new",
          completionCriteria: s.completionCriteria || null,
          measurableOutcome: s.measurableOutcome || null,
          dependencies: s.dependencies || null,
          suggestedApproach: s.suggestedApproach || null,
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
                  completionCriteria: string | null;
                  measurableOutcome: string | null;
                  dependencies: string | null;
                  suggestedApproach: string | null;
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
                  // 新しいフィールドは既存のカラムがない場合、descriptionに統合
                  completionCriteria: s.completionCriteria,
                  measurableOutcome: s.measurableOutcome,
                  dependencies: s.dependencies,
                  suggestedApproach: s.suggestedApproach,
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
    "/suggestions/ai/cache", async ({  query  }: any) => {
      const { themeId } = query as any;

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
        completionCriteria?: string | null;
        measurableOutcome?: string | null;
        dependencies?: string | null;
        suggestedApproach?: string | null;
      }) => ({
        title: c.title,
        description: c.description,
        priority: c.priority,
        estimatedHours: c.estimatedHours,
        reason: c.reason,
        category: c.category,
        completionCriteria: c.completionCriteria || null,
        measurableOutcome: c.measurableOutcome || null,
        dependencies: c.dependencies || null,
        suggestedApproach: c.suggestedApproach || null,
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
    "/suggestions/ai/cache", async ({  query  }: any) => {
      const { themeId } = query as any;

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
    "/", async ({  query  }: any) => {
      const { projectId, milestoneId, priority, since } = query as any;

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

        const [updated, totalCount, allIds] = await Promise.all([
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
          // 現在存在する全タスクのIDを取得（削除検出用）
          prisma.task.findMany({
            where: baseWhere,
            select: { id: true },
          }),
        ]);

        return {
          tasks: updated,
          totalCount,
          activeIds: allIds.map((t) => t.id), // 現在アクティブなタスクIDのリスト
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
  .get("/:id", async ({  params  }: any) => {
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
    "/", async ({  body  }: any) => {
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
      } = body as any;

      try {
        // サブタスク作成時はトランザクションで重複チェックと作成を原子的に実行
        if (parentId) {
          // 親タスクの存在確認
          const parentTask = await prisma.task.findUnique({
            where: { id: parentId },
            select: { id: true },
          });

          if (!parentTask) {
            throw new AppError(400, `親タスク(ID: ${parentId})が見つかりません`);
          }

          const result = await prisma.$transaction(async (tx: typeof prisma) => {
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

            const createdTask = await tx.task.findUnique({
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

            return createdTask;
          }, {
            isolationLevel: 'Serializable', // 競合を防ぐための分離レベル
          });

          // サブタスクは行動記録しない（親タスクのみ記録）
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
        const createdTask = await prisma.task.findUnique({
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

        // ユーザー行動を記録（親タスクのみ）
        if (!parentId && createdTask) {
          await UserBehaviorService.recordTaskCreated(createdTask.id, createdTask);
        }

        return createdTask;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        console.error("[tasks] Failed to create task:", error);
        throw new AppError(500, "タスクの作成に失敗しました");
      }
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
    "/:id", async ({  params, body  }: any) => {
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
      } = body as any;

      // 現在のタスクの状態を取得（行動記録のため）
      const currentTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true, parentId: true }
      });

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
          ...(status === "in_progress" && currentTask?.status !== "in_progress" && { startedAt: new Date() }),
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

      // 更新後のタスクを取得
      const updatedTask = await prisma.task.findUnique({
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

      // ユーザー行動を記録（親タスクのみ）
      if (!currentTask?.parentId && updatedTask) {
        // 状態変更に応じて行動を記録
        if (status && currentTask?.status !== status) {
          if (status === "in_progress" && currentTask?.status !== "in_progress") {
            await UserBehaviorService.recordTaskStarted(taskId, updatedTask);
          } else if (status === "done" && currentTask?.status !== "done") {
            await UserBehaviorService.recordTaskCompleted(taskId, updatedTask);
          }
        }

        // タスクの更新も記録（状態変更以外）
        if (title || description !== undefined || priority || themeId !== undefined) {
          await UserBehaviorService.recordBehavior("task_updated", {
            taskId,
            themeId: updatedTask.themeId,
            metadata: {
              changes: {
                title: title !== undefined,
                description: description !== undefined,
                priority: priority !== undefined,
                themeId: themeId !== undefined,
              }
            }
          });
        }
      }

      return updatedTask;
    }
  )

  // Delete task
  .delete("/:id", async ({  params  }: any) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.task.delete({
      where: { id },
    });
  })

  // 重複サブタスクを削除（特定のタスク配下）
  .post("/:id/cleanup-duplicates", async ({  params  }: any) => {
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
  .delete("/:id/subtasks", async ({  params  }: any) => {
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
    "/:id/subtasks/delete-selected", async ({  params, body  }: any) => {
      const parentId = parseInt(params.id);
      if (isNaN(parentId)) {
        throw new ValidationError("無効なIDです");
      }

      const { subtaskIds } = body as any;

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

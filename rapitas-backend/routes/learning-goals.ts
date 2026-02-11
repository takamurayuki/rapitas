/**
 * Learning Goals API Routes
 * 学習目標の作成、AI学習プラン生成、タスクへの適用
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import {
  sendAIMessage,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  type AIMessage,
} from "../utils/ai-client";

export const learningGoalsRoutes = new Elysia({ prefix: "/learning-goals" })
  // 全学習目標を取得
  .get("/", async () => {
    return await prisma.learningGoal.findMany({
      orderBy: { createdAt: "desc" },
    });
  })

  // 学習目標をIDで取得
  .get("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.learningGoal.findUnique({
      where: { id },
    });
  })

  // 学習目標を作成
  .post(
    "/",
    async ({
      body,
    }: {
      body: {
        title: string;
        description?: string;
        currentLevel?: string;
        targetLevel?: string;
        deadline?: string;
        dailyHours?: number;
        categoryId?: number;
      };
    }) => {
      const { title, description, currentLevel, targetLevel, deadline, dailyHours, categoryId } = body;

      return await prisma.learningGoal.create({
        data: {
          title,
          ...(description && { description }),
          ...(currentLevel && { currentLevel }),
          ...(targetLevel && { targetLevel }),
          ...(deadline && { deadline: new Date(deadline) }),
          ...(dailyHours !== undefined && { dailyHours }),
          ...(categoryId !== undefined && { categoryId }),
        },
      });
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        currentLevel: t.Optional(t.String()),
        targetLevel: t.Optional(t.String()),
        deadline: t.Optional(t.String()),
        dailyHours: t.Optional(t.Number()),
        categoryId: t.Optional(t.Number()),
      }),
    }
  )

  // 学習目標を更新
  .patch(
    "/:id",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: {
        title?: string;
        description?: string;
        currentLevel?: string;
        targetLevel?: string;
        deadline?: string | null;
        dailyHours?: number;
        status?: string;
        isApplied?: boolean;
        themeId?: number | null;
      };
    }) => {
      const id = parseInt(params.id);
      const updateData: Record<string, unknown> = {};

      if (body.title !== undefined) updateData.title = body.title;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.currentLevel !== undefined) updateData.currentLevel = body.currentLevel;
      if (body.targetLevel !== undefined) updateData.targetLevel = body.targetLevel;
      if (body.deadline !== undefined) updateData.deadline = body.deadline ? new Date(body.deadline) : null;
      if (body.dailyHours !== undefined) updateData.dailyHours = body.dailyHours;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.isApplied !== undefined) updateData.isApplied = body.isApplied;
      if (body.themeId !== undefined) updateData.themeId = body.themeId;

      return await prisma.learningGoal.update({
        where: { id },
        data: updateData,
      });
    }
  )

  // 学習目標を削除
  .delete("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.learningGoal.delete({
      where: { id },
    });
  })

  // AI学習プランを生成
  .post(
    "/:id/generate-plan",
    async ({ params }: { params: { id: string } }) => {
      const id = parseInt(params.id);

      const goal = await prisma.learningGoal.findUnique({
        where: { id },
      });

      if (!goal) {
        return { error: "Learning goal not found" };
      }

      const aiAvailable = await isAnyApiKeyConfigured();

      // 期限までの日数を計算
      let totalDays = 90; // デフォルト3ヶ月
      if (goal.deadline) {
        const now = new Date();
        totalDays = Math.max(
          7,
          Math.ceil((goal.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );
      }

      if (!aiAvailable) {
        // AI未設定時のフォールバック生成
        const plan = generateFallbackPlan(goal.title, goal.currentLevel, goal.targetLevel, totalDays, goal.dailyHours);
        await prisma.learningGoal.update({
          where: { id },
          data: { generatedPlan: JSON.stringify(plan) },
        });
        return { plan, source: "fallback" };
      }

      // AI生成
      const systemPrompt = `あなたは学習計画の専門家です。ユーザーの学習目標に対して、具体的で実行可能な学習プランを生成してください。

以下の基準で学習プランを生成してください：
1. 目標達成に必要な知識・スキルを体系的に分解する
2. 各フェーズには具体的な学習ソース（書籍名、Webサイト、コース名、問題集など）を明記する
3. タスクは「〜を読む」「〜を解く」「〜を実装する」のように具体的なアクションにする
4. 期限に合わせた現実的なペース配分にする
5. 必要に応じてサブタスク（より細かい学習ステップ）を含める

必ず以下のJSON形式で回答してください：
{
  "themeName": "この学習目標に最適なテーマ名（カテゴリの学習に紐づく）",
  "themeDescription": "テーマの簡潔な説明",
  "phases": [
    {
      "name": "フェーズ名（例: 基礎固め、応用力強化）",
      "days": フェーズの日数,
      "description": "このフェーズの目的",
      "tasks": [
        {
          "title": "タスク名（具体的なアクション）",
          "description": "タスクの詳細説明。具体的な学習ソース（書籍名、URL、コース名など）を含む。",
          "estimatedHours": 見積もり時間,
          "priority": "high" | "medium" | "low",
          "subtasks": [
            {
              "title": "サブタスク名",
              "description": "サブタスクの説明",
              "estimatedHours": 見積もり時間
            }
          ]
        }
      ]
    }
  ],
  "recommendedResources": [
    {
      "title": "リソース名",
      "type": "book" | "website" | "course" | "video" | "practice",
      "description": "リソースの説明",
      "url": "URLがあれば"
    }
  ],
  "tips": ["学習のコツやアドバイス"]
}`;

      const userPrompt = `## 学習目標
**${goal.title}**

${goal.description ? `## 詳細説明\n${goal.description}\n` : ""}
## 現在のレベル
${goal.currentLevel || "未指定"}

## 目標レベル
${goal.targetLevel || "未指定"}

## 期間
${totalDays}日間（1日${goal.dailyHours}時間の学習時間を確保）

上記の学習目標に対して、期限内に達成するための具体的な学習プランを生成してください。
各タスクには必ず具体的な学習ソース（書籍、Webサイト、動画、問題集など）を説明に含めてください。
サブタスクは必要に応じて含め、タスクが大きすぎる場合は分割してください。`;

      try {
        const provider = await getDefaultProvider();
        const messages: AIMessage[] = [{ role: "user", content: userPrompt }];

        const response = await sendAIMessage({
          provider,
          messages,
          systemPrompt,
          maxTokens: 4096,
        });

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("[learning-goals] Failed to parse AI response");
          const fallbackPlan = generateFallbackPlan(goal.title, goal.currentLevel, goal.targetLevel, totalDays, goal.dailyHours);
          await prisma.learningGoal.update({
            where: { id },
            data: { generatedPlan: JSON.stringify(fallbackPlan) },
          });
          return { plan: fallbackPlan, source: "fallback" };
        }

        const plan = JSON.parse(jsonMatch[0]);

        await prisma.learningGoal.update({
          where: { id },
          data: { generatedPlan: JSON.stringify(plan) },
        });

        return { plan, source: "ai", tokensUsed: response.tokensUsed };
      } catch (error) {
        console.error("[learning-goals] AI plan generation failed:", error);
        const fallbackPlan = generateFallbackPlan(goal.title, goal.currentLevel, goal.targetLevel, totalDays, goal.dailyHours);
        await prisma.learningGoal.update({
          where: { id },
          data: { generatedPlan: JSON.stringify(fallbackPlan) },
        });
        return { plan: fallbackPlan, source: "fallback" };
      }
    }
  )

  // 学習プランをタスクに適用（テーマ作成 → タスク・サブタスク登録）
  .post("/:id/apply", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);

    const goal = await prisma.learningGoal.findUnique({
      where: { id },
    });

    if (!goal) {
      return { error: "Learning goal not found" };
    }

    if (!goal.generatedPlan) {
      return { error: "No generated plan found. Please generate a plan first." };
    }

    if (goal.isApplied) {
      return { error: "This plan has already been applied." };
    }

    const plan = JSON.parse(goal.generatedPlan as string) as GeneratedLearningPlan;

    // 1. 学習カテゴリを取得（なければ作成）
    let categoryId = goal.categoryId;
    if (!categoryId) {
      const learningCategory = await prisma.category.findFirst({
        where: { mode: "learning" },
      });
      categoryId = learningCategory?.id ?? null;
    }

    // 2. テーマを作成
    const theme = await prisma.theme.create({
      data: {
        name: plan.themeName || goal.title,
        description: plan.themeDescription || goal.description || `学習目標: ${goal.title}`,
        color: "#8B5CF6",
        isDevelopment: false,
        ...(categoryId && { categoryId }),
      },
    });

    // 3. フェーズごとにタスクを作成
    const createdTasks = [];
    let currentDate = new Date();

    for (const phase of plan.phases) {
      const phaseEndDate = new Date(currentDate);
      phaseEndDate.setDate(phaseEndDate.getDate() + phase.days);

      for (const taskDef of phase.tasks) {
        const task = await prisma.task.create({
          data: {
            title: taskDef.title,
            description: buildTaskDescription(phase.name, taskDef.description, goal.title),
            status: "todo",
            priority: taskDef.priority || "medium",
            estimatedHours: taskDef.estimatedHours || null,
            dueDate: phaseEndDate,
            subject: goal.title,
            themeId: theme.id,
          },
        });

        // サブタスクがあれば作成
        if (taskDef.subtasks && taskDef.subtasks.length > 0) {
          for (const sub of taskDef.subtasks) {
            await prisma.task.create({
              data: {
                title: sub.title,
                description: sub.description || null,
                status: "todo",
                priority: taskDef.priority || "medium",
                estimatedHours: sub.estimatedHours || null,
                parentId: task.id,
                themeId: theme.id,
                subject: goal.title,
              },
            });
          }
        }

        createdTasks.push(task);
      }

      currentDate = phaseEndDate;
    }

    // 4. 学習目標を適用済みに更新
    await prisma.learningGoal.update({
      where: { id },
      data: { isApplied: true, themeId: theme.id },
    });

    return {
      success: true,
      themeId: theme.id,
      themeName: theme.name,
      createdTaskCount: createdTasks.length,
    };
  });

// --- Helper Types & Functions ---

type GeneratedLearningPlan = {
  themeName?: string;
  themeDescription?: string;
  phases: {
    name: string;
    days: number;
    description?: string;
    tasks: {
      title: string;
      description: string;
      estimatedHours?: number;
      priority?: string;
      subtasks?: {
        title: string;
        description?: string;
        estimatedHours?: number;
      }[];
    }[];
  }[];
  recommendedResources?: {
    title: string;
    type: string;
    description: string;
    url?: string;
  }[];
  tips?: string[];
};

function buildTaskDescription(phaseName: string, description: string, goalTitle: string): string {
  return `**学習目標:** ${goalTitle}\n**フェーズ:** ${phaseName}\n\n${description}`;
}

function generateFallbackPlan(
  title: string,
  currentLevel: string | null,
  targetLevel: string | null,
  totalDays: number,
  dailyHours: number
): GeneratedLearningPlan {
  const phaseDays = Math.floor(totalDays / 3);

  return {
    themeName: title,
    themeDescription: `${title}の学習`,
    phases: [
      {
        name: "基礎固め",
        days: phaseDays,
        description: "基本的な知識やスキルを習得するフェーズ",
        tasks: [
          {
            title: `${title}の基本概念を学習`,
            description: `${title}に関する基礎知識を体系的に学習します。入門書やオンラインコースを活用してください。`,
            estimatedHours: dailyHours * 5,
            priority: "high",
          },
          {
            title: "学習ロードマップの作成",
            description: `${currentLevel || "現在のレベル"}から${targetLevel || "目標レベル"}に到達するためのロードマップを整理します。`,
            estimatedHours: 2,
            priority: "high",
          },
        ],
      },
      {
        name: "実践・応用",
        days: phaseDays,
        description: "学んだ知識を実践に適用するフェーズ",
        tasks: [
          {
            title: `${title}の応用課題に取り組む`,
            description: "基礎知識を活かした応用的な課題やプロジェクトに取り組みます。",
            estimatedHours: dailyHours * 7,
            priority: "high",
          },
          {
            title: "弱点分野の補強",
            description: "基礎段階で見つかった弱点を重点的に学習します。",
            estimatedHours: dailyHours * 3,
            priority: "medium",
          },
        ],
      },
      {
        name: "総仕上げ・実力確認",
        days: totalDays - phaseDays * 2,
        description: "目標達成に向けた最終調整フェーズ",
        tasks: [
          {
            title: "総合的な実力テスト",
            description: `${targetLevel || "目標レベル"}に到達しているかを確認する実力テストを行います。`,
            estimatedHours: dailyHours * 3,
            priority: "high",
          },
          {
            title: "復習と最終調整",
            description: "これまでの学習内容を振り返り、不足している部分を補強します。",
            estimatedHours: dailyHours * 5,
            priority: "medium",
          },
        ],
      },
    ],
    tips: [
      "毎日同じ時間に学習する習慣をつけましょう",
      "学んだ内容はアウトプットすることで定着します",
      "進捗を定期的に振り返り、プランを調整しましょう",
    ],
  };
}

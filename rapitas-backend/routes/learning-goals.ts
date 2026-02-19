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
  .get("/:id", async ({  params  }: any) => {
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

        // サブタスクがあれば作成（順序を保持）
        if (taskDef.subtasks && taskDef.subtasks.length > 0) {
          const hoursPerDay = Math.min(goal.dailyHours, 8); // 1日あたりの最大学習時間
          let accumulatedDays = 0;

          for (let i = 0; i < taskDef.subtasks.length; i++) {
            const sub = taskDef.subtasks[i];
            const subtaskDays = Math.ceil((sub.estimatedHours || 0) / hoursPerDay);

            // サブタスクの期限を計算（親タスクの期限内に収める）
            const subtaskDueDate = new Date(currentDate);
            subtaskDueDate.setDate(subtaskDueDate.getDate() + accumulatedDays + subtaskDays);

            // 期限が親タスクの期限を超えないように調整
            const adjustedDueDate = subtaskDueDate > phaseEndDate ? phaseEndDate : subtaskDueDate;

            await prisma.task.create({
              data: {
                title: `${i + 1}. ${sub.title}`,
                description: sub.description || null,
                status: "todo",
                priority: taskDef.priority || "medium",
                estimatedHours: sub.estimatedHours || null,
                parentId: task.id,
                themeId: theme.id,
                subject: goal.title,
                dueDate: adjustedDueDate,
                createdAt: new Date(Date.now() + i * 1000), // createdAtで順序を保証
              },
            });

            accumulatedDays += subtaskDays;
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
            subtasks: [
              {
                title: "入門教材の選定と学習環境の準備",
                description: "評価の高い入門書やオンラインコースを選び、学習環境を整えます",
                estimatedHours: 2,
              },
              {
                title: "基本概念の理解（第1週）",
                description: "選定した教材の前半部分を学習し、基本用語と概念を理解します",
                estimatedHours: Math.floor((dailyHours * 5 - 2) / 2),
              },
              {
                title: "基本概念の定着（第2週）",
                description: "教材の後半部分を学習し、演習問題やサンプルで理解を深めます",
                estimatedHours: Math.ceil((dailyHours * 5 - 2) / 2),
              },
            ],
          },
          {
            title: "学習ロードマップの作成",
            description: `${currentLevel || "現在のレベル"}から${targetLevel || "目標レベル"}に到達するためのロードマップを整理します。`,
            estimatedHours: 2,
            priority: "high",
            subtasks: [
              {
                title: "現在のスキルレベルの棚卸し",
                description: "現在できること・できないことを具体的にリストアップします",
                estimatedHours: 0.5,
              },
              {
                title: "目標達成に必要なスキルの洗い出し",
                description: "目標レベルに必要なスキルを調査し、習得すべき項目を特定します",
                estimatedHours: 1,
              },
              {
                title: "学習計画の具体化",
                description: "優先順位をつけて、週単位・月単位の学習計画を立てます",
                estimatedHours: 0.5,
              },
            ],
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
            subtasks: [
              {
                title: "実践課題の選定",
                description: "現在のレベルに適した実践的な課題やミニプロジェクトを選びます",
                estimatedHours: 1,
              },
              {
                title: "課題への取り組み（前半）",
                description: "選定した課題に着手し、基礎知識を応用しながら進めます",
                estimatedHours: Math.floor((dailyHours * 7 - 1) / 2),
              },
              {
                title: "課題への取り組み（後半）と振り返り",
                description: "課題を完成させ、学んだことを整理・記録します",
                estimatedHours: Math.ceil((dailyHours * 7 - 1) / 2),
              },
            ],
          },
          {
            title: "弱点分野の補強",
            description: "基礎段階で見つかった弱点を重点的に学習します。",
            estimatedHours: dailyHours * 3,
            priority: "medium",
            subtasks: [
              {
                title: "弱点の特定と優先順位付け",
                description: "実践を通じて明らかになった弱点を整理し、優先順位をつけます",
                estimatedHours: 0.5,
              },
              {
                title: "重点学習の実施",
                description: "優先度の高い弱点から順に、追加教材や演習で補強します",
                estimatedHours: dailyHours * 3 - 0.5,
              },
            ],
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
            subtasks: [
              {
                title: "模擬テストや実践課題の準備",
                description: "目標レベルを測定できる適切なテストや課題を選定します",
                estimatedHours: 1,
              },
              {
                title: "実力テストの実施",
                description: "時間を計って本番同様の環境でテストを実施します",
                estimatedHours: dailyHours * 3 - 2,
              },
              {
                title: "結果の分析と改善点の特定",
                description: "テスト結果を分析し、最終調整が必要な箇所を明確にします",
                estimatedHours: 1,
              },
            ],
          },
          {
            title: "復習と最終調整",
            description: "これまでの学習内容を振り返り、不足している部分を補強します。",
            estimatedHours: dailyHours * 5,
            priority: "medium",
            subtasks: [
              {
                title: "重要項目の総復習",
                description: "これまでに学んだ重要概念やスキルを体系的に復習します",
                estimatedHours: Math.floor(dailyHours * 5 / 2),
              },
              {
                title: "最終調整と仕上げ",
                description: "実力テストで判明した弱点を重点的に補強し、目標達成を確実にします",
                estimatedHours: Math.ceil(dailyHours * 5 / 2),
              },
            ],
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

/**
 * Learning Goals API Routes
 * 学習目標の作成、AI学習プラン生成、タスクへの適用
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:learning-goals');
import {
  sendAIMessage,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  type AIMessage,
} from '../../utils/ai-client';

export const learningGoalsRoutes = new Elysia({ prefix: '/learning-goals' })
  // 全学習目標を取得
  .get('/', async () => {
    return await prisma.learningGoal.findMany({
      orderBy: { createdAt: 'desc' },
    });
  })

  // 学習目標をIDで取得
  .get('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    return await prisma.learningGoal.findUnique({
      where: { id },
    });
  })

  // 学習目標を作成
  .post(
    '/',
    async (context) => {
      const { title, description, currentLevel, targetLevel, deadline, dailyHours, categoryId } =
        context.body as {
          title: string;
          description?: string;
          currentLevel?: string;
          targetLevel?: string;
          deadline?: string;
          dailyHours?: number;
          categoryId?: number;
        };

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
    },
  )

  // 学習目標を更新
  .patch(
    '/:id',
    async (context) => {
      const { params, body } = context;
      const id = parseInt(params.id as string);
      const updateData: Record<string, unknown> = {};

      const bodyData = body as {
        title?: string;
        description?: string;
        currentLevel?: string;
        targetLevel?: string;
        deadline?: string;
        dailyHours?: number;
        status?: string;
        isApplied?: boolean;
        themeId?: number;
      };

      if (bodyData.title !== undefined) updateData.title = bodyData.title;
      if (bodyData.description !== undefined) updateData.description = bodyData.description;
      if (bodyData.currentLevel !== undefined) updateData.currentLevel = bodyData.currentLevel;
      if (bodyData.targetLevel !== undefined) updateData.targetLevel = bodyData.targetLevel;
      if (bodyData.deadline !== undefined)
        updateData.deadline = bodyData.deadline ? new Date(bodyData.deadline) : null;
      if (bodyData.dailyHours !== undefined) updateData.dailyHours = bodyData.dailyHours;
      if (bodyData.status !== undefined) updateData.status = bodyData.status;
      if (bodyData.isApplied !== undefined) updateData.isApplied = bodyData.isApplied;
      if (bodyData.themeId !== undefined) updateData.themeId = bodyData.themeId;

      return await prisma.learningGoal.update({
        where: { id },
        data: updateData,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        currentLevel: t.Optional(t.String()),
        targetLevel: t.Optional(t.String()),
        deadline: t.Optional(t.String()),
        dailyHours: t.Optional(t.Number()),
        status: t.Optional(t.String()),
        isApplied: t.Optional(t.Boolean()),
        themeId: t.Optional(t.Number()),
      }),
    },
  )

  // 学習目標を削除
  .delete('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    return await prisma.learningGoal.delete({
      where: { id },
    });
  })

  // AI学習プランを生成
  .post('/:id/generate-plan', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);

    const goal = await prisma.learningGoal.findUnique({
      where: { id },
    });

    if (!goal) {
      return { error: 'Learning goal not found' };
    }

    const aiAvailable = await isAnyApiKeyConfigured();

    // 期限までの日数を計算
    let totalDays = 90; // デフォルト3ヶ月
    if (goal.deadline) {
      const now = new Date();
      totalDays = Math.max(
        7,
        Math.ceil((goal.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }

    if (!aiAvailable) {
      // AI未設定時のフォールバック生成
      const plan = generateFallbackPlan(
        goal.title,
        goal.currentLevel,
        goal.targetLevel,
        totalDays,
        goal.dailyHours,
      );
      await prisma.learningGoal.update({
        where: { id },
        data: { generatedPlan: JSON.stringify(plan) },
      });
      return { plan, source: 'fallback' };
    }

    // AI生成
    const systemPrompt = `あなたは学習計画の専門家です。ユーザーの学習目標に対して、具体的で実行可能な学習プランを生成してください。

以下の基準で学習プランを生成してください：
1. 目標達成に必要な知識・スキルを体系的に分解する
2. 各フェーズには具体的な学習ソース（書籍名、Webサイト、コース名、問題集など）を明記する
3. タスクは「〜を読む」「〜を解く」「〜を実装する」のように具体的なアクションにする
4. 期限に合わせた現実的なペース配分にする
5. サブタスクは実施順序を考慮して、ステップバイステップで実行可能な粒度にする
6. 各サブタスクには必ず見積もり時間を設定し、全サブタスクの合計時間がタスクの見積もり時間と一致するようにする

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
              "title": "サブタスク名（具体的なステップ）",
              "description": "サブタスクの詳細説明。何を、どのように、どこまで実施するか明確に記載",
              "estimatedHours": 見積もり時間（必須、0.5時間単位）
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

${goal.description ? `## 詳細説明\n${goal.description}\n` : ''}
## 現在のレベル
${goal.currentLevel || '未指定'}

## 目標レベル
${goal.targetLevel || '未指定'}

## 期間
${totalDays}日間（1日${goal.dailyHours}時間の学習時間を確保）

上記の学習目標に対して、期限内に達成するための具体的な学習プランを生成してください。

重要：
- 各タスクには必ず具体的な学習ソース（書籍、Webサイト、動画、問題集など）を説明に含めてください
- サブタスクは実行順序を考慮し、前のサブタスクの成果物や知識を次のサブタスクで使うような流れにしてください
- サブタスクの粒度は1〜4時間で完了できるものにし、具体的に何をするか一目でわかるようにしてください
- 各サブタスクには必ず見積もり時間を0.5時間単位で設定してください
- サブタスクの合計時間がタスクの見積もり時間と一致するようにしてください`;

    try {
      const provider = await getDefaultProvider();
      const messages: AIMessage[] = [{ role: 'user', content: userPrompt }];

      const response = await sendAIMessage({
        provider,
        messages,
        systemPrompt,
        maxTokens: 4096,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.error('[learning-goals] Failed to parse AI response');
        const fallbackPlan = generateFallbackPlan(
          goal.title,
          goal.currentLevel,
          goal.targetLevel,
          totalDays,
          goal.dailyHours,
        );
        await prisma.learningGoal.update({
          where: { id },
          data: { generatedPlan: JSON.stringify(fallbackPlan) },
        });
        return { plan: fallbackPlan, source: 'fallback' };
      }

      const plan = JSON.parse(jsonMatch[0]);

      await prisma.learningGoal.update({
        where: { id },
        data: { generatedPlan: JSON.stringify(plan) },
      });

      return { plan, source: 'ai', tokensUsed: response.tokensUsed };
    } catch (error) {
      log.error({ err: error }, '[learning-goals] AI plan generation failed');
      const fallbackPlan = generateFallbackPlan(
        goal.title,
        goal.currentLevel,
        goal.targetLevel,
        totalDays,
        goal.dailyHours,
      );
      await prisma.learningGoal.update({
        where: { id },
        data: { generatedPlan: JSON.stringify(fallbackPlan) },
      });
      return { plan: fallbackPlan, source: 'fallback' };
    }
  })

  // 学習プランをタスクに適用（テーマ作成 → タスク・サブタスク登録）
  .post('/:id/apply', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);

    const goal = await prisma.learningGoal.findUnique({
      where: { id },
    });

    if (!goal) {
      return { error: 'Learning goal not found' };
    }

    if (!goal.generatedPlan) {
      return { error: 'No generated plan found. Please generate a plan first.' };
    }

    if (goal.isApplied) {
      return { error: 'This plan has already been applied.' };
    }

    const plan = JSON.parse(goal.generatedPlan as string) as GeneratedLearningPlan;

    // 1. 学習カテゴリを取得（なければ作成）
    let categoryId = goal.categoryId;
    if (!categoryId) {
      const learningCategory = await prisma.category.findFirst({
        where: { mode: 'learning' },
      });
      categoryId = learningCategory?.id ?? null;
    }

    // 2. テーマを作成
    const theme = await prisma.theme.create({
      data: {
        name: plan.themeName || goal.title,
        description: plan.themeDescription || goal.description || `学習目標: ${goal.title}`,
        color: '#8B5CF6',
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
            status: 'todo',
            priority: taskDef.priority || 'medium',
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
                status: 'todo',
                priority: taskDef.priority || 'medium',
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

    // 5. フェーズごとにフラッシュカードデッキを作成（fire-and-forget）
    const deckIds: number[] = [];
    const aiAvailable = await isAnyApiKeyConfigured();

    for (let phaseIdx = 0; phaseIdx < plan.phases.length; phaseIdx++) {
      const phase = plan.phases[phaseIdx];
      const deck = await prisma.flashcardDeck.create({
        data: {
          name: `${goal.title} - ${phase.name}`,
          description: phase.description || `${goal.title}のフェーズ${phaseIdx + 1}: ${phase.name}`,
          color: '#8B5CF6',
          learningGoalId: id,
          phaseIndex: phaseIdx,
        },
      });
      deckIds.push(deck.id);

      // AI でフラッシュカードを非同期生成（fire-and-forget）
      if (aiAvailable) {
        generateFlashcardsForPhase(deck.id, phase, goal.title).catch((err) => {
          log.error(
            { err },
            `[learning-goals] Failed to generate flashcards for phase ${phaseIdx}`,
          );
        });
      }
    }

    return {
      success: true,
      themeId: theme.id,
      themeName: theme.name,
      createdTaskCount: createdTasks.length,
      createdDeckCount: deckIds.length,
      deckIds,
    };
  })

  // 進捗に基づく計画適応
  .post('/:id/adapt', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);

    const goal = await prisma.learningGoal.findUnique({
      where: { id },
    });

    if (!goal) {
      return { error: 'Learning goal not found' };
    }

    if (!goal.generatedPlan || !goal.themeId) {
      return { error: 'No applied plan found. Please generate and apply a plan first.' };
    }

    const aiAvailable = await isAnyApiKeyConfigured();
    if (!aiAvailable) {
      return { error: 'AI is not configured. Please set up an API key.' };
    }

    // テーマ配下のタスク進捗を取得
    const tasks = await prisma.task.findMany({
      where: { themeId: goal.themeId, parentId: null },
      include: { subtasks: true },
    });

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'done').length;
    const progressRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

    // 残り日数を計算
    let remainingDays = 30;
    if (goal.deadline) {
      const now = new Date();
      remainingDays = Math.max(
        1,
        Math.ceil((goal.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }

    const plan = JSON.parse(goal.generatedPlan as string) as GeneratedLearningPlan;

    const completedTaskTitles = tasks.filter((t) => t.status === 'done').map((t) => t.title);
    const remainingTaskTitles = tasks.filter((t) => t.status !== 'done').map((t) => t.title);

    const provider = await getDefaultProvider();
    const messages: AIMessage[] = [
      {
        role: 'user',
        content: `## 学習目標の計画適応

**学習目標:** ${goal.title}
**進捗率:** ${Math.round(progressRate * 100)}% (${completedTasks}/${totalTasks}タスク完了)
**残り日数:** ${remainingDays}日
**1日の学習時間:** ${goal.dailyHours}時間

### 完了済みタスク
${completedTaskTitles.length > 0 ? completedTaskTitles.map((t) => `- ${t}`).join('\n') : 'なし'}

### 未完了タスク
${remainingTaskTitles.length > 0 ? remainingTaskTitles.map((t) => `- ${t}`).join('\n') : 'なし'}

### 元の計画
${JSON.stringify(plan, null, 2)}

上記の進捗状況と残り日数を考慮して、残りのフェーズの最適化された学習計画を生成してください。
完了済みのタスクはスキップし、未完了タスクの優先順位を調整してください。

必ず元の計画と同じJSON形式で回答してください。`,
      },
    ];

    try {
      const response = await sendAIMessage({
        provider,
        messages,
        systemPrompt:
          'あなたは学習計画の最適化専門家です。進捗状況に基づいて、残りの学習計画を最適化してください。必ずJSON形式で回答してください。',
        maxTokens: 4096,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { error: 'Failed to parse AI response' };
      }

      const adaptedPlan = JSON.parse(jsonMatch[0]);

      await prisma.learningGoal.update({
        where: { id },
        data: { generatedPlan: JSON.stringify(adaptedPlan) },
      });

      return {
        success: true,
        adaptedPlan,
        progressRate: Math.round(progressRate * 100),
        remainingDays,
        tokensUsed: response.tokensUsed,
      };
    } catch (error) {
      log.error({ err: error }, '[learning-goals] Plan adaptation failed');
      return { error: 'Failed to adapt plan' };
    }
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

async function generateFlashcardsForPhase(
  deckId: number,
  phase: GeneratedLearningPlan['phases'][0],
  goalTitle: string,
): Promise<void> {
  const taskSummary = phase.tasks.map((t) => `- ${t.title}: ${t.description}`).join('\n');

  const provider = await getDefaultProvider();
  const messages: AIMessage[] = [
    {
      role: 'user',
      content: `以下の学習フェーズの内容から、復習用のフラッシュカード（Q&Aペア）を8枚作成してください。

【重要】フラッシュカード設計原則：
- 1枚のカードには1つの概念のみ（最小情報原則）
- 回答は短く端的に（1〜3文、100文字以内）。長い説明文は書かない
- 暗記・復習に適した形式にする
- 「〜とは？」「〜の目的は？」のような具体的な質問にする

**学習目標:** ${goalTitle}
**フェーズ:** ${phase.name}
**内容:**
${taskSummary}

以下のJSON形式のみで出力（余計なテキスト不要）：
{"cards":[{"front":"質問","back":"回答"}]}`,
    },
  ];

  const response = await sendAIMessage({
    provider: 'ollama',
    messages,
    systemPrompt:
      'フラッシュカード生成専門AIです。学習内容から重要な概念を抽出し、短く端的なQ&Aペアを作成してください。回答は暗記しやすい簡潔な表現にし、長い説明は避けてください。JSON形式のみで回答してください。',
    maxTokens: 2048,
  });

  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.error('[learning-goals] Failed to parse flashcard AI response');
    return;
  }

  const data = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(data.cards) || data.cards.length === 0) return;

  await prisma.flashcard.createMany({
    data: data.cards.map((card: { front: string; back: string }) => ({
      deckId,
      front: card.front,
      back: card.back,
    })),
  });

  log.info(`[learning-goals] Generated ${data.cards.length} flashcards for deck ${deckId}`);
}

function generateFallbackPlan(
  title: string,
  currentLevel: string | null,
  targetLevel: string | null,
  totalDays: number,
  dailyHours: number,
): GeneratedLearningPlan {
  const phaseDays = Math.floor(totalDays / 3);

  return {
    themeName: title,
    themeDescription: `${title}の学習`,
    phases: [
      {
        name: '基礎固め',
        days: phaseDays,
        description: '基本的な知識やスキルを習得するフェーズ',
        tasks: [
          {
            title: `${title}の基本概念を学習`,
            description: `${title}に関する基礎知識を体系的に学習します。入門書やオンラインコースを活用してください。`,
            estimatedHours: dailyHours * 5,
            priority: 'high',
            subtasks: [
              {
                title: '入門教材の選定と学習環境の準備',
                description: '評価の高い入門書やオンラインコースを選び、学習環境を整えます',
                estimatedHours: 2,
              },
              {
                title: '基本概念の理解（第1週）',
                description: '選定した教材の前半部分を学習し、基本用語と概念を理解します',
                estimatedHours: Math.floor((dailyHours * 5 - 2) / 2),
              },
              {
                title: '基本概念の定着（第2週）',
                description: '教材の後半部分を学習し、演習問題やサンプルで理解を深めます',
                estimatedHours: Math.ceil((dailyHours * 5 - 2) / 2),
              },
            ],
          },
          {
            title: '学習ロードマップの作成',
            description: `${currentLevel || '現在のレベル'}から${targetLevel || '目標レベル'}に到達するためのロードマップを整理します。`,
            estimatedHours: 2,
            priority: 'high',
            subtasks: [
              {
                title: '現在のスキルレベルの棚卸し',
                description: '現在できること・できないことを具体的にリストアップします',
                estimatedHours: 0.5,
              },
              {
                title: '目標達成に必要なスキルの洗い出し',
                description: '目標レベルに必要なスキルを調査し、習得すべき項目を特定します',
                estimatedHours: 1,
              },
              {
                title: '学習計画の具体化',
                description: '優先順位をつけて、週単位・月単位の学習計画を立てます',
                estimatedHours: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '実践・応用',
        days: phaseDays,
        description: '学んだ知識を実践に適用するフェーズ',
        tasks: [
          {
            title: `${title}の応用課題に取り組む`,
            description: '基礎知識を活かした応用的な課題やプロジェクトに取り組みます。',
            estimatedHours: dailyHours * 7,
            priority: 'high',
            subtasks: [
              {
                title: '実践課題の選定',
                description: '現在のレベルに適した実践的な課題やミニプロジェクトを選びます',
                estimatedHours: 1,
              },
              {
                title: '課題への取り組み（前半）',
                description: '選定した課題に着手し、基礎知識を応用しながら進めます',
                estimatedHours: Math.floor((dailyHours * 7 - 1) / 2),
              },
              {
                title: '課題への取り組み（後半）と振り返り',
                description: '課題を完成させ、学んだことを整理・記録します',
                estimatedHours: Math.ceil((dailyHours * 7 - 1) / 2),
              },
            ],
          },
          {
            title: '弱点分野の補強',
            description: '基礎段階で見つかった弱点を重点的に学習します。',
            estimatedHours: dailyHours * 3,
            priority: 'medium',
            subtasks: [
              {
                title: '弱点の特定と優先順位付け',
                description: '実践を通じて明らかになった弱点を整理し、優先順位をつけます',
                estimatedHours: 0.5,
              },
              {
                title: '重点学習の実施',
                description: '優先度の高い弱点から順に、追加教材や演習で補強します',
                estimatedHours: dailyHours * 3 - 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '総仕上げ・実力確認',
        days: totalDays - phaseDays * 2,
        description: '目標達成に向けた最終調整フェーズ',
        tasks: [
          {
            title: '総合的な実力テスト',
            description: `${targetLevel || '目標レベル'}に到達しているかを確認する実力テストを行います。`,
            estimatedHours: dailyHours * 3,
            priority: 'high',
            subtasks: [
              {
                title: '模擬テストや実践課題の準備',
                description: '目標レベルを測定できる適切なテストや課題を選定します',
                estimatedHours: 1,
              },
              {
                title: '実力テストの実施',
                description: '時間を計って本番同様の環境でテストを実施します',
                estimatedHours: dailyHours * 3 - 2,
              },
              {
                title: '結果の分析と改善点の特定',
                description: 'テスト結果を分析し、最終調整が必要な箇所を明確にします',
                estimatedHours: 1,
              },
            ],
          },
          {
            title: '復習と最終調整',
            description: 'これまでの学習内容を振り返り、不足している部分を補強します。',
            estimatedHours: dailyHours * 5,
            priority: 'medium',
            subtasks: [
              {
                title: '重要項目の総復習',
                description: 'これまでに学んだ重要概念やスキルを体系的に復習します',
                estimatedHours: Math.floor((dailyHours * 5) / 2),
              },
              {
                title: '最終調整と仕上げ',
                description: '実力テストで判明した弱点を重点的に補強し、目標達成を確実にします',
                estimatedHours: Math.ceil((dailyHours * 5) / 2),
              },
            ],
          },
        ],
      },
    ],
    tips: [
      '毎日同じ時間に学習する習慣をつけましょう',
      '学んだ内容はアウトプットすることで定着します',
      '進捗を定期的に振り返り、プランを調整しましょう',
    ],
  };
}

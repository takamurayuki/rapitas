/**
 * Learning Goal Plan Handlers
 *
 * Route handlers for AI plan generation and progress-based plan adaptation.
 * The /apply endpoint lives in learning-goal-apply-handler.ts to keep file size under 300 lines.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  sendAIMessage,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  type AIMessage,
} from '../../../utils/ai-client';
import {
  type GeneratedLearningPlan,
  generateFallbackPlan,
} from '../learning-goal-helpers';

const log = createLogger('routes:learning-goals:plan');

export const learningGoalPlanRoutes = new Elysia()
  // Generate AI learning plan
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

    // Calculate days until deadline
    let totalDays = 90; // default 3 months
    if (goal.deadline) {
      const now = new Date();
      totalDays = Math.max(
        7,
        Math.ceil((goal.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }

    if (!aiAvailable) {
      // Fallback generation when AI is not configured
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

  // Adapt plan based on progress
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

    // Get task progress under the theme
    const tasks = await prisma.task.findMany({
      where: { themeId: goal.themeId, parentId: null },
      include: { subtasks: true },
    });

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'done').length;
    const progressRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

    // Calculate remaining days
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

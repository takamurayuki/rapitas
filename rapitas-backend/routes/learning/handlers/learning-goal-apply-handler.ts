/**
 * Learning Goal Apply Handler
 *
 * Route handler for applying a generated learning plan to the task system:
 * creates a theme, tasks, subtasks, and flashcard decks.
 * Flashcard generation is fire-and-forget to avoid blocking the HTTP response.
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
  buildTaskDescription,
} from '../learning-goal-helpers';

const log = createLogger('routes:learning-goals:apply');

export const learningGoalApplyRoutes = new Elysia()
  // Apply learning plan to tasks (create theme, tasks, and subtasks)
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

    // 1. Get learning category (create if absent)
    let categoryId = goal.categoryId;
    if (!categoryId) {
      const learningCategory = await prisma.category.findFirst({
        where: { mode: 'learning' },
      });
      categoryId = learningCategory?.id ?? null;
    }

    // 2. Create theme
    const theme = await prisma.theme.create({
      data: {
        name: plan.themeName || goal.title,
        description: plan.themeDescription || goal.description || `学習目標: ${goal.title}`,
        color: '#8B5CF6',
        isDevelopment: false,
        ...(categoryId && { categoryId }),
      },
    });

    // 3. Create tasks per phase
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

        // Create subtasks if defined (preserve order)
        if (taskDef.subtasks && taskDef.subtasks.length > 0) {
          const hoursPerDay = Math.min(goal.dailyHours, 8); // Max study hours per day
          let accumulatedDays = 0;

          for (let i = 0; i < taskDef.subtasks.length; i++) {
            const sub = taskDef.subtasks[i];
            const subtaskDays = Math.ceil((sub.estimatedHours || 0) / hoursPerDay);

            // Calculate subtask due date (within parent deadline)
            const subtaskDueDate = new Date(currentDate);
            subtaskDueDate.setDate(subtaskDueDate.getDate() + accumulatedDays + subtaskDays);

            // Clamp due date to not exceed parent deadline
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
                createdAt: new Date(Date.now() + i * 1000), // stagger createdAt to preserve order
              },
            });

            accumulatedDays += subtaskDays;
          }
        }

        createdTasks.push(task);
      }

      currentDate = phaseEndDate;
    }

    // 4. Mark learning goal as applied
    await prisma.learningGoal.update({
      where: { id },
      data: { isApplied: true, themeId: theme.id },
    });

    // 5. Create flashcard decks per phase (fire-and-forget)
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

      // Generate flashcards asynchronously via AI (fire-and-forget)
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
  });

/**
 * Generates flashcards for a single learning phase via AI and persists them to the database.
 * Intentionally fire-and-forget; callers must `.catch()` errors.
 *
 * @param deckId - ID of the flashcard deck to populate / フラッシュカードデッキID
 * @param phase - The learning phase to generate cards for / 対象フェーズ
 * @param goalTitle - Title of the parent learning goal / 学習目標タイトル
 */
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

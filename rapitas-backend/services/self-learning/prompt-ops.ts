/**
 * Prompt Evolution Operations
 *
 * Records prompt evolution history and retrieves past prompt changes
 * to track improvement over time. Pattern and statistics operations
 * live in pattern-ops.ts and stats-ops.ts respectively.
 */
import { prisma } from '../../config/database';
import type { CreatePromptEvolutionInput } from './types';

/**
 * Records a prompt evolution entry linking before/after prompts to an experiment.
 *
 * @param input - Prompt evolution creation parameters / プロンプト進化の作成パラメータ
 * @returns Newly created PromptEvolution record / 作成されたPromptEvolutionレコード
 */
export async function recordPromptEvolution(input: CreatePromptEvolutionInput) {
  return prisma.promptEvolution.create({
    data: {
      experimentId: input.experimentId,
      category: input.category,
      beforePrompt: input.beforePrompt,
      afterPrompt: input.afterPrompt,
      improvement: input.improvement,
      performanceDelta: input.performanceDelta ?? 0,
    },
  });
}

/**
 * Returns the most recent 50 prompt evolution records, optionally filtered by category.
 *
 * @param category - Optional category filter / カテゴリフィルタ（省略可）
 * @returns Array of PromptEvolution records ordered by creation date / 作成日順のPromptEvolutionレコード一覧
 */
export async function getPromptEvolutionHistory(category?: string) {
  const where: Record<string, unknown> = {};
  if (category) where.category = category;

  return prisma.promptEvolution.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

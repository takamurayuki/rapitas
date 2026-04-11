/**
 * Pattern Operations
 *
 * CRUD and analysis functions for LearningPattern records: creating patterns,
 * listing them with pagination, and deriving patterns from experiment outcomes.
 * Statistics and prompt evolution operations live in separate modules.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { CreatePatternInput, LearningPatternType, LearningCategory } from './types';

const log = createLogger('self-learning:learning');

/**
 * Analyzes why an experiment failed and updates matching known failure patterns.
 *
 * @param experimentId - Experiment to analyze / 分析対象の実験ID
 * @returns List of failure reason strings / 失敗理由の文字列リスト
 * @throws {Error} When the experiment is not found
 */
export async function analyzeFailure(experimentId: number): Promise<string[]> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
  });

  if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

  const evaluation = experiment.evaluation ? JSON.parse(experiment.evaluation) : null;

  const failureReasons: string[] = [];

  if (evaluation) {
    if (evaluation.testsFailed > 0) {
      failureReasons.push(`${evaluation.testsFailed} tests failed`);
    }
    if (evaluation.errorsEncountered?.length > 0) {
      failureReasons.push(`Errors: ${evaluation.errorsEncountered.join(', ')}`);
    }
    if (!evaluation.overallSuccess) {
      failureReasons.push('Overall evaluation marked as unsuccessful');
    }
  }

  const similarPatterns = await prisma.learningPattern.findMany({
    where: { patternType: 'failure_pattern' },
    orderBy: { occurrences: 'desc' },
    take: 5,
  });

  for (const pattern of similarPatterns) {
    const conditions = JSON.parse(pattern.conditions);
    const matchesAny = conditions.some((c: { value: string }) =>
      failureReasons.some((r) => r.toLowerCase().includes(c.value.toLowerCase())),
    );
    if (matchesAny) {
      await prisma.learningPattern.update({
        where: { id: pattern.id },
        data: {
          occurrences: pattern.occurrences + 1,
          lastObserved: new Date(),
        },
      });
      failureReasons.push(`Matches known pattern: ${pattern.description}`);
    }
  }

  log.info({ experimentId, reasons: failureReasons.length }, 'Failure analysis completed');
  return failureReasons;
}

/**
 * Extracts successful strategies from a completed experiment and stores them as patterns.
 *
 * @param experimentId - Experiment to extract strategies from / 戦略抽出対象の実験ID
 * @returns List of strategy description strings / 戦略説明の文字列リスト
 * @throws {Error} When the experiment is not found
 */
export async function extractStrategy(experimentId: number): Promise<string[]> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
  });

  if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

  const strategies: string[] = [];

  const validatedHypotheses = await prisma.hypothesis.findMany({
    where: { experimentId, status: 'validated' },
  });
  for (const h of validatedHypotheses) {
    strategies.push(`Validated approach: ${h.content}`);
  }

  const goodReviews = await prisma.criticReview.findMany({
    where: { experimentId, overallScore: { gte: 0.7 } },
  });
  for (const r of goodReviews) {
    strategies.push(`High-quality ${r.phase}: ${r.feedback.slice(0, 100)}`);
  }

  if (strategies.length > 0 && experiment.status === 'completed') {
    await createPattern({
      patternType: 'success_strategy',
      category: 'feature_implementation',
      description: `Success strategy from experiment "${experiment.title}"`,
      conditions: [
        {
          field: 'task_type',
          operator: 'contains',
          value: experiment.title.split(' ')[0] ?? '',
        },
      ],
      actions: strategies.map((s) => ({
        type: 'suggest_approach' as const,
        description: s,
      })),
      confidence: experiment.confidence,
    });
  }

  log.info({ experimentId, strategies: strategies.length }, 'Strategy extraction completed');
  return strategies;
}

/**
 * Creates a new LearningPattern record.
 *
 * @param input - Pattern creation parameters / パターン作成パラメータ
 * @returns Newly created LearningPattern record / 作成されたLearningPatternレコード
 */
export async function createPattern(input: CreatePatternInput) {
  return prisma.learningPattern.create({
    data: {
      patternType: input.patternType,
      category: input.category,
      description: input.description,
      conditions: JSON.stringify(input.conditions ?? []),
      actions: JSON.stringify(input.actions ?? []),
      confidence: input.confidence ?? 0.5,
    },
  });
}

/**
 * Lists LearningPattern records with optional filtering and pagination.
 *
 * @param options - Filter and pagination options / フィルタ・ページネーションオプション
 * @returns Paginated pattern list with parsed JSON fields / ページネーション付きパターン一覧
 */
export async function listPatterns(
  options: {
    patternType?: LearningPatternType;
    category?: LearningCategory;
    page?: number;
    limit?: number;
  } = {},
) {
  const { patternType, category, page = 1, limit = 20 } = options;

  const where: Record<string, unknown> = {};
  if (patternType) where.patternType = patternType;
  if (category) where.category = category;

  const [patterns, total] = await Promise.all([
    prisma.learningPattern.findMany({
      where,
      orderBy: [{ occurrences: 'desc' }, { confidence: 'desc' }],
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.learningPattern.count({ where }),
  ]);

  return {
    patterns: (
      patterns as Array<{
        conditions: string;
        actions: string;
        metadata: string;
        [key: string]: unknown;
      }>
    ).map((p) => ({
      ...p,
      conditions: JSON.parse(p.conditions),
      actions: JSON.parse(p.actions),
      metadata: JSON.parse(p.metadata),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

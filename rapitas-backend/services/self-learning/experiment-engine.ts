/**
 * Experiment Engine - 実験ループの管理
 *
 * Research → Hypothesis → Plan → Execute → Evaluate → Learn
 * のサイクルを自律的に回す。
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { appendEvent } from '../memory/timeline';
import { searchKnowledge } from '../memory/rag/search';
import type {
  CreateExperimentInput,
  UpdateExperimentInput,
  ExperimentPhase,
  ExperimentResearch,
  ExperimentPlan,
  ExperimentEvaluation,
  ExperimentLearning,
} from './types';

const log = createLogger('self-learning:experiment');

/**
 * 新しい実験を作成
 */
export async function createExperiment(input: CreateExperimentInput) {
  const experiment = await prisma.experiment.create({
    data: {
      taskId: input.taskId,
      title: input.title,
      status: 'created',
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });

  await appendEvent({
    eventType: 'agent_execution_started',
    payload: {
      experimentId: experiment.id,
      taskId: input.taskId,
      title: input.title,
    },
  });

  log.info({ experimentId: experiment.id }, 'Experiment created');
  return experiment;
}

/**
 * 実験のステータスと各フェーズのデータを更新
 */
export async function updateExperiment(id: number, input: UpdateExperimentInput) {
  const data: Record<string, unknown> = {};

  if (input.status) data.status = input.status;
  if (input.research) data.research = JSON.stringify(input.research);
  if (input.hypothesis) data.hypothesis = input.hypothesis;
  if (input.plan) data.plan = JSON.stringify(input.plan);
  if (input.execution) data.execution = JSON.stringify(input.execution);
  if (input.result) data.result = JSON.stringify(input.result);
  if (input.evaluation) data.evaluation = JSON.stringify(input.evaluation);
  if (input.learning) data.learning = JSON.stringify(input.learning);
  if (input.confidence !== undefined) data.confidence = input.confidence;

  if (input.status === 'executing' && !data.startedAt) {
    data.startedAt = new Date();
  }
  if (input.status === 'completed' || input.status === 'failed') {
    data.completedAt = new Date();
    const exp = await prisma.experiment.findUnique({ where: { id } });
    if (exp?.startedAt) {
      data.duration = new Date().getTime() - new Date(exp.startedAt).getTime();
    }
  }

  const experiment = await prisma.experiment.update({
    where: { id },
    data,
  });

  log.info({ experimentId: id, status: input.status }, 'Experiment updated');
  return experiment;
}

/**
 * Research フェーズ: 情報収集
 */
export async function runResearch(
  experimentId: number,
  query: string,
): Promise<ExperimentResearch> {
  await updateExperiment(experimentId, { status: 'researching' });

  // 既存の知識ベースから関連情報を検索
  let memoryResults: string[] = [];
  try {
    const searchResults = await searchKnowledge({ query, limit: 5 });
    memoryResults = searchResults.map(
      (r: { category: string; title: string; content: string }) =>
        `[${r.category}] ${r.title}: ${r.content.slice(0, 200)}`,
    );
  } catch {
    log.warn('Knowledge search failed, continuing without memory results');
  }

  // 過去の類似実験を検索
  const relatedExperiments = await prisma.experiment.findMany({
    where: {
      status: 'completed',
      title: { contains: query.split(' ')[0] ?? '', mode: 'insensitive' },
    },
    select: { id: true },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  const research: ExperimentResearch = {
    memorySearch: memoryResults,
    relatedExperiments: (relatedExperiments as Array<{ id: number }>).map((e) => e.id),
    summary: `Research completed. Found ${memoryResults.length} knowledge entries and ${relatedExperiments.length} related experiments.`,
  };

  await updateExperiment(experimentId, { research, status: 'researching' });

  log.info({ experimentId }, 'Research phase completed');
  return research;
}

/**
 * 実験詳細を取得
 */
export async function getExperiment(id: number) {
  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: {
      hypotheses: { orderBy: { priority: 'desc' } },
      criticReviews: { orderBy: { createdAt: 'desc' } },
      episodes: { orderBy: { createdAt: 'asc' } },
      promptEvolutions: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!experiment) return null;

  return {
    ...experiment,
    research: JSON.parse(experiment.research),
    hypothesis: experiment.hypothesis ? JSON.parse(experiment.hypothesis) : null,
    plan: experiment.plan ? JSON.parse(experiment.plan) : null,
    execution: experiment.execution ? JSON.parse(experiment.execution) : null,
    result: experiment.result ? JSON.parse(experiment.result) : null,
    evaluation: experiment.evaluation ? JSON.parse(experiment.evaluation) : null,
    learning: experiment.learning ? JSON.parse(experiment.learning) : null,
    metadata: JSON.parse(experiment.metadata),
  };
}

/**
 * 実験一覧を取得
 */
export async function listExperiments(
  options: {
    page?: number;
    limit?: number;
    status?: ExperimentPhase;
    taskId?: number;
  } = {},
) {
  const { page = 1, limit = 20, status, taskId } = options;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (taskId) where.taskId = taskId;

  const [experiments, total] = await Promise.all([
    prisma.experiment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
      include: {
        _count: {
          select: {
            hypotheses: true,
            criticReviews: true,
            episodes: true,
          },
        },
      },
    }),
    prisma.experiment.count({ where }),
  ]);

  return {
    experiments: (experiments as Array<{ metadata: string; [key: string]: unknown }>).map((e) => ({
      ...e,
      metadata: JSON.parse(e.metadata),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * 実験のタイムライン（エピソード時系列）を取得
 */
export async function getExperimentTimeline(experimentId: number) {
  return prisma.episodeMemory.findMany({
    where: { experimentId },
    orderBy: { createdAt: 'asc' },
  });
}

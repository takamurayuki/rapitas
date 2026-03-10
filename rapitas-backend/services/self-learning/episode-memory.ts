/**
 * Episode Memory - エピソード記憶
 *
 * 各実験のフェーズごとの詳細な記録を保持する。
 * Short Memory（現在のタスクコンテキスト）とEpisode Memory（実験ログ）を統合管理。
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { CreateEpisodeInput, EpisodePhase } from './types';

const log = createLogger('self-learning:episode-memory');

/**
 * エピソードを保存
 */
export async function saveEpisode(input: CreateEpisodeInput) {
  const episode = await prisma.episodeMemory.create({
    data: {
      experimentId: input.experimentId,
      phase: input.phase,
      content: input.content,
      context: JSON.stringify(input.context ?? {}),
      outcome: input.outcome,
      emotionalTag: input.emotionalTag,
      importance: input.importance ?? 0.5,
    },
  });

  log.info(
    { episodeId: episode.id, experimentId: input.experimentId, phase: input.phase },
    'Episode saved',
  );
  return episode;
}

/**
 * 類似エピソードを検索
 */
export async function findSimilarEpisodes(
  query: string,
  options: {
    phase?: EpisodePhase;
    limit?: number;
    minImportance?: number;
  } = {},
) {
  const { phase, limit = 10, minImportance = 0 } = options;

  const where: Record<string, unknown> = {
    content: { contains: query, mode: 'insensitive' },
    importance: { gte: minImportance },
  };
  if (phase) where.phase = phase;

  return prisma.episodeMemory.findMany({
    where,
    include: {
      experiment: {
        select: { id: true, title: true, status: true },
      },
    },
    orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
}

/**
 * 実験のエピソードを要約
 */
export async function summarizeExperiment(experimentId: number) {
  const episodes = await prisma.episodeMemory.findMany({
    where: { experimentId },
    orderBy: { createdAt: 'asc' },
  });

  if (episodes.length === 0) return null;

  interface EpisodeRecord {
    id: number;
    phase: string;
    content: string;
    outcome: string | null;
    emotionalTag: string | null;
    importance: number;
  }

  const phaseMap = new Map<string, EpisodeRecord[]>();
  for (const ep of episodes as EpisodeRecord[]) {
    const existing = phaseMap.get(ep.phase) ?? [];
    existing.push(ep);
    phaseMap.set(ep.phase, existing);
  }

  const summary: Record<
    string,
    {
      count: number;
      outcomes: string[];
      highlights: string[];
    }
  > = {};

  for (const [phase, phaseEpisodes] of phaseMap) {
    summary[phase] = {
      count: phaseEpisodes.length,
      outcomes: phaseEpisodes
        .filter((e: EpisodeRecord) => e.outcome)
        .map((e: EpisodeRecord) => e.outcome!),
      highlights: phaseEpisodes
        .filter((e: EpisodeRecord) => e.importance >= 0.7)
        .map((e: EpisodeRecord) => e.content.slice(0, 100)),
    };
  }

  return {
    experimentId,
    totalEpisodes: episodes.length,
    phases: summary,
    importantMoments: (episodes as EpisodeRecord[])
      .filter((e: EpisodeRecord) => e.importance >= 0.8)
      .map((e: EpisodeRecord) => ({
        phase: e.phase,
        content: e.content.slice(0, 200),
        emotionalTag: e.emotionalTag,
      })),
  };
}

/**
 * エピソード統計を取得
 */
export async function getEpisodeStats() {
  const [total, byPhase, byOutcome, avgImportance] = await Promise.all([
    prisma.episodeMemory.count(),
    prisma.episodeMemory.groupBy({
      by: ['phase'],
      _count: { id: true },
    }),
    prisma.episodeMemory.groupBy({
      by: ['outcome'],
      _count: { id: true },
    }),
    prisma.episodeMemory.aggregate({
      _avg: { importance: true },
    }),
  ]);

  return {
    total,
    byPhase: Object.fromEntries(
      (byPhase as Array<{ phase: string; _count: { id: number } }>).map((p) => [
        p.phase,
        p._count.id,
      ]),
    ),
    byOutcome: Object.fromEntries(
      (byOutcome as Array<{ outcome: string | null; _count: { id: number } }>)
        .filter((o) => o.outcome !== null)
        .map((o) => [o.outcome!, o._count.id]),
    ),
    averageImportance: avgImportance._avg.importance ?? 0,
  };
}

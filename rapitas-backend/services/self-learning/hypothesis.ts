/**
 * Hypothesis Manager - 仮説の生成・追跡・検証
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { CreateHypothesisInput, HypothesisStatus, HypothesisTestResult } from './types';

const log = createLogger('self-learning:hypothesis');

/**
 * 仮説を作成
 */
export async function createHypothesis(input: CreateHypothesisInput) {
  const hypothesis = await prisma.hypothesis.create({
    data: {
      experimentId: input.experimentId,
      content: input.content,
      reasoning: input.reasoning,
      confidence: input.confidence ?? 0.5,
      priority: input.priority ?? 50,
      parentId: input.parentId,
    },
  });

  log.info({ hypothesisId: hypothesis.id, experimentId: input.experimentId }, 'Hypothesis created');
  return hypothesis;
}

/**
 * 仮説のステータスを更新
 */
export async function updateHypothesisStatus(
  id: number,
  status: HypothesisStatus,
  testResult?: HypothesisTestResult,
) {
  const data: Record<string, unknown> = { status };

  if (testResult) {
    data.testResult = JSON.stringify(testResult);
    // テスト結果に基づいて信頼度を更新
    if (testResult.passed) {
      data.confidence = Math.min(1.0, 0.8 + (testResult.metrics?.accuracy ?? 0));
    } else {
      data.confidence = Math.max(0, 0.2 - (testResult.metrics?.errorRate ?? 0));
    }
  }

  const hypothesis = await prisma.hypothesis.update({
    where: { id },
    data,
  });

  log.info({ hypothesisId: id, status }, 'Hypothesis status updated');
  return hypothesis;
}

/**
 * 仮説を改訂（新バージョンを作成）
 */
export async function reviseHypothesis(
  originalId: number,
  revisedContent: string,
  reasoning?: string,
) {
  const original = await prisma.hypothesis.findUnique({
    where: { id: originalId },
  });

  if (!original) throw new Error(`Hypothesis ${originalId} not found`);

  // 元の仮説を「revised」に更新
  await updateHypothesisStatus(originalId, 'revised');

  // 新しい仮説を作成
  return createHypothesis({
    experimentId: original.experimentId,
    content: revisedContent,
    reasoning: reasoning ?? `Revised from hypothesis #${originalId}`,
    confidence: original.confidence,
    priority: original.priority + 10,
    parentId: originalId,
  });
}

/**
 * 実験の仮説一覧を取得
 */
export async function getHypotheses(experimentId: number) {
  return prisma.hypothesis.findMany({
    where: { experimentId },
    orderBy: [{ priority: 'desc' }, { confidence: 'desc' }],
  });
}

/**
 * 仮説をランキング（信頼度×優先度でソート）
 */
export async function rankHypotheses(experimentId: number) {
  const hypotheses = await prisma.hypothesis.findMany({
    where: {
      experimentId,
      status: { in: ['proposed', 'testing'] },
    },
  });

  return hypotheses
    .map((h: { confidence: number; priority: number; [key: string]: unknown }) => ({
      ...h,
      score: h.confidence * (h.priority / 100),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
}

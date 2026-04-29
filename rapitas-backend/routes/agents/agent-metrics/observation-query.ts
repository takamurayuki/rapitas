/**
 * Self-Observation Queries
 *
 * Aggregates the per-execution metrics that the orchestrator already records
 * (costUsd, cacheReadInputTokens, cacheCreationInputTokens, modelName) into
 * a single dashboard payload. This complements the broader agent-metrics
 * routes by focusing on cost / cache effectiveness / model mix — the data
 * needed for "is the agent helping me or burning my budget?".
 */

import { prisma } from '../../../config/database';

export interface DailyCostPoint {
  /** ISO date (YYYY-MM-DD), UTC. */
  date: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  executions: number;
}

export interface ModelMixEntry {
  modelName: string;
  executions: number;
  costUsd: number;
  shareOfCost: number;
}

export interface SelfObservationSummary {
  windowDays: number;
  totalCostUsd: number;
  totalExecutions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadInputTokens: number;
  totalCacheCreationInputTokens: number;
  /** cache_read / (cache_read + input). 1.0 means everything was cached. */
  cacheHitRate: number;
  /** failed / total. */
  errorRate: number;
  averageExecutionTimeMs: number | null;
  dailyCost: DailyCostPoint[];
  modelMix: ModelMixEntry[];
}

interface ExecutionMetricRow {
  startedAt: Date | null;
  createdAt: Date;
  status: string;
  errorMessage: string | null;
  executionTimeMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: unknown; // Prisma Decimal — stringified
  modelName: string | null;
}

/** Convert Prisma Decimal | string | number to JS number. */
function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  // Prisma Decimal exposes toString()
  return parseFloat(String(v)) || 0;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a self-observation snapshot for the last `windowDays` days.
 *
 * @param windowDays - Trailing window size (default 14) / 集計対象日数
 */
export async function getSelfObservationSummary(windowDays = 14): Promise<SelfObservationSummary> {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1));

  const rows = (await prisma.agentExecution.findMany({
    where: { createdAt: { gte: cutoff } },
    select: {
      startedAt: true,
      createdAt: true,
      status: true,
      errorMessage: true,
      executionTimeMs: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadInputTokens: true,
      cacheCreationInputTokens: true,
      costUsd: true,
      modelName: true,
    },
  })) as ExecutionMetricRow[];

  let totalCostUsd = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalTime = 0;
  let timeSamples = 0;
  let failed = 0;

  // Pre-seed buckets so the chart shows a continuous timeline even on quiet days.
  const dailyMap = new Map<string, DailyCostPoint>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(cutoff);
    d.setUTCDate(cutoff.getUTCDate() + i);
    const key = isoDate(d);
    dailyMap.set(key, {
      date: key,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      executions: 0,
    });
  }

  const modelMap = new Map<string, { executions: number; costUsd: number }>();

  for (const r of rows) {
    const cost = toNumber(r.costUsd);
    totalCostUsd += cost;
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalCacheRead += r.cacheReadInputTokens;
    totalCacheCreation += r.cacheCreationInputTokens;
    if (r.executionTimeMs && r.executionTimeMs > 0) {
      totalTime += r.executionTimeMs;
      timeSamples++;
    }
    if (r.status === 'failed' || r.errorMessage) failed++;

    const dayKey = isoDate(r.startedAt ?? r.createdAt);
    const bucket = dailyMap.get(dayKey);
    if (bucket) {
      bucket.costUsd += cost;
      bucket.inputTokens += r.inputTokens;
      bucket.outputTokens += r.outputTokens;
      bucket.cacheReadInputTokens += r.cacheReadInputTokens;
      bucket.executions += 1;
    }

    const model = r.modelName ?? 'unknown';
    const ms = modelMap.get(model) ?? { executions: 0, costUsd: 0 };
    ms.executions += 1;
    ms.costUsd += cost;
    modelMap.set(model, ms);
  }

  const cacheableInput = totalInput + totalCacheRead;
  const cacheHitRate = cacheableInput > 0 ? totalCacheRead / cacheableInput : 0;
  const errorRate = rows.length > 0 ? failed / rows.length : 0;
  const averageExecutionTimeMs = timeSamples > 0 ? Math.round(totalTime / timeSamples) : null;

  const modelMix: ModelMixEntry[] = Array.from(modelMap.entries())
    .map(([modelName, v]) => ({
      modelName,
      executions: v.executions,
      costUsd: round6(v.costUsd),
      shareOfCost: totalCostUsd > 0 ? v.costUsd / totalCostUsd : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const dailyCost = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      costUsd: round6(d.costUsd),
    }));

  return {
    windowDays,
    totalCostUsd: round6(totalCostUsd),
    totalExecutions: rows.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadInputTokens: totalCacheRead,
    totalCacheCreationInputTokens: totalCacheCreation,
    cacheHitRate: round4(cacheHitRate),
    errorRate: round4(errorRate),
    averageExecutionTimeMs,
    dailyCost,
    modelMix,
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

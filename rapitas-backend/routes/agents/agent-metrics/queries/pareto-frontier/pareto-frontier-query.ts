/**
 * Pareto Frontier Query
 *
 * Aggregates the trailing-window AgentExecution rows into per-segment
 * (workflow type x role) candidate points — one per model actually invoked —
 * with 95% confidence intervals on execution time, success rate and cost,
 * then marks the Pareto-optimal set. CPU/memory are NOT available:
 * AgentExecution records no process telemetry, so `costUsd` is the resource
 * objective and the response says so via `metrics.cpuMemoryAvailable`.
 */

import { prisma } from '../../../../../config/database';
import { WORKFLOW_MODES } from '../../../../../services/workflow/workflow-types';
import { toInt, toNumber } from '../../metric-coercion';
import { markParetoOptimal } from './pareto-dominance';
import { MIN_RELIABLE_SAMPLES, meanInterval, round, wilsonInterval } from './pareto-statistics';
import type {
  ComplexityBand,
  ComplexityFilter,
  ParetoExecutionRow,
  ParetoFrontierResult,
  ParetoMetricsInfo,
  ParetoPoint,
  ParetoSegment,
  SegmentBaseline,
  WorkflowType,
} from './pareto-frontier-types';

/** Options accepted by the frontier builder and the API route. */
export interface ParetoFrontierOptions {
  windowDays: number;
  complexityBand: ComplexityFilter;
  /** Workflow role to isolate, or `all`. */
  role: string;
}

/** Upper bound on rows scanned per request (30 days of executions fits comfortably). */
const MAX_ROWS = 20000;

/** Executions still in flight carry no outcome and are excluded from every objective. */
const NON_TERMINAL_STATUSES = new Set(['pending', 'running', 'waiting_for_input']);

// SSOT: mode names come from WORKFLOW_MODES (check-ssot-drift Domain D).
const WORKFLOW_TYPES: readonly WorkflowType[] = WORKFLOW_MODES;

/** Objective/CI descriptor shared by both endpoints. */
export const PARETO_METRICS_INFO: ParetoMetricsInfo = {
  resourceAxis: 'costUsd',
  cpuMemoryAvailable: false,
  confidenceLevel: 0.95,
  minReliableSamples: MIN_RELIABLE_SAMPLES,
};

interface Accumulator {
  total: number;
  success: number;
  times: number[];
  costs: number[];
  tokens: number;
}

interface SegmentAccumulator {
  workflowType: WorkflowType;
  role: string;
  all: Accumulator;
  byModel: Map<string, Accumulator>;
}

function emptyAccumulator(): Accumulator {
  return { total: 0, success: 0, times: [], costs: [], tokens: 0 };
}

/**
 * Maps Task.workflowMode to the segment axis.
 *
 * @param mode - Raw workflowMode / 生の値
 * @returns Workflow type (`unknown` when unset or unrecognised) / ワークフロータイプ
 */
export function toWorkflowType(mode: string | null | undefined): WorkflowType {
  return WORKFLOW_TYPES.find((t) => t === mode) ?? 'unknown';
}

/**
 * Bands Task.complexityScore the same way cost-optimization-suggestions does
 * so both panels split on identical thresholds.
 *
 * @param score - complexityScore 0-100 / 複雑度スコア
 * @returns Band, or null when the score is missing / 帯域
 */
export function toComplexityBand(score: number | null | undefined): ComplexityBand | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score <= 35) return 'low';
  if (score <= 70) return 'medium';
  return 'high';
}

function workflowRole(mode: string | null | undefined): string | null {
  if (!mode?.startsWith('workflow-')) return null;
  const role = mode.slice('workflow-'.length).trim();
  return role || null;
}

function accumulate(acc: Accumulator, row: ParetoExecutionRow): void {
  acc.total += 1;
  if (row.status === 'completed') acc.success += 1;
  const time = toInt(row.executionTimeMs);
  if (time > 0) acc.times.push(time);
  acc.costs.push(toNumber(row.costUsd));
  acc.tokens += toInt(row.tokensUsed);
}

function toBaseline(acc: Accumulator): SegmentBaseline {
  return {
    sampleSize: acc.total,
    reliable: acc.total >= MIN_RELIABLE_SAMPLES,
    successRate: wilsonInterval(acc.success, acc.total),
    executionTimeMs: meanInterval(acc.times, 0),
    costUsd: meanInterval(acc.costs, 4),
  };
}

function toPoint(role: string, model: string, acc: Accumulator): ParetoPoint {
  return {
    ...toBaseline(acc),
    key: `${role}/${model}`,
    parameterSet: { role, model },
    successCount: acc.success,
    avgTokens: acc.total > 0 ? Math.round(acc.tokens / acc.total) : 0,
    paretoOptimal: false,
  };
}

/**
 * Pure aggregation: rows -> segments with CI-bearing points and Pareto marks.
 * Rows without a workflow role or a model name cannot form a parameter set
 * and are dropped; in-flight rows are dropped because they have no outcome.
 *
 * @param rows - AgentExecution rows / 実行行
 * @param options - Window and filters / 集計条件
 * @returns Segments sorted by workflow type then role / セグメント一覧
 */
export function buildParetoSegments(
  rows: ParetoExecutionRow[],
  options: Pick<ParetoFrontierOptions, 'complexityBand' | 'role'>,
): ParetoSegment[] {
  const segments = new Map<string, SegmentAccumulator>();

  for (const row of rows) {
    if (NON_TERMINAL_STATUSES.has(row.status)) continue;
    const role = workflowRole(row.session?.mode);
    if (!role || !row.modelName) continue;
    if (options.role !== 'all' && role !== options.role) continue;
    const task = row.session?.config?.task;
    if (
      options.complexityBand !== 'all' &&
      toComplexityBand(task?.complexityScore) !== options.complexityBand
    ) {
      continue;
    }
    const workflowType = toWorkflowType(task?.workflowMode);
    const key = `${workflowType}:${role}`;
    const segment = segments.get(key) ?? {
      workflowType,
      role,
      all: emptyAccumulator(),
      byModel: new Map<string, Accumulator>(),
    };
    accumulate(segment.all, row);
    const modelAcc = segment.byModel.get(row.modelName) ?? emptyAccumulator();
    accumulate(modelAcc, row);
    segment.byModel.set(row.modelName, modelAcc);
    segments.set(key, segment);
  }

  const typeOrder = (t: WorkflowType): number => {
    const idx = WORKFLOW_TYPES.indexOf(t);
    return idx === -1 ? WORKFLOW_TYPES.length : idx;
  };

  return [...segments.values()]
    .map((segment) => ({
      workflowType: segment.workflowType,
      role: segment.role,
      sampleSize: segment.all.total,
      baseline: toBaseline(segment.all),
      points: markParetoOptimal(
        [...segment.byModel.entries()]
          .map(([model, acc]) => toPoint(segment.role, model, acc))
          .sort((a, b) => b.sampleSize - a.sampleSize),
      ),
    }))
    .sort(
      (a, b) =>
        typeOrder(a.workflowType) - typeOrder(b.workflowType) || a.role.localeCompare(b.role),
    );
}

/**
 * Loads the trailing-window execution rows needed by the frontier builder.
 *
 * @param windowDays - Trailing window size / 集計日数
 * @returns Rows plus the window bounds / 行と期間
 */
export async function fetchParetoRows(
  windowDays: number,
): Promise<{ rows: ParetoExecutionRow[]; from: Date; to: Date }> {
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const rows = (await prisma.agentExecution.findMany({
    where: { createdAt: { gte: from } },
    select: {
      status: true,
      modelName: true,
      tokensUsed: true,
      costUsd: true,
      executionTimeMs: true,
      session: {
        select: {
          mode: true,
          config: {
            select: { task: { select: { workflowMode: true, complexityScore: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
  })) as unknown as ParetoExecutionRow[];
  return { rows, from, to };
}

/**
 * Builds the Pareto frontier for the trailing window.
 *
 * @param options - Window and filters / 集計条件
 * @returns Frontier payload / フロンティア
 */
export async function getParetoFrontier(
  options: ParetoFrontierOptions,
): Promise<ParetoFrontierResult> {
  const { rows, from, to } = await fetchParetoRows(options.windowDays);
  return {
    windowDays: options.windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    totalExecutions: rows.length,
    filters: { complexityBand: options.complexityBand, role: options.role },
    metrics: PARETO_METRICS_INFO,
    segments: buildParetoSegments(rows, options),
  };
}

/**
 * Projects a window count onto a 30-day month.
 *
 * @param sampleSize - Executions in the window / 期間内件数
 * @param windowDays - Window length / 期間日数
 * @returns Executions per 30 days / 月間件数
 */
export function monthlyVolume(sampleSize: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return round((sampleSize * 30) / windowDays, 1);
}

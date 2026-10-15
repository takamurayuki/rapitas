/**
 * repair-risk-inputs
 *
 * DB read side of the repair-risk predictor: loads transitions, context-size
 * metrics and task facts, builds the cell table (TTL-cached per process) and
 * resolves a task's input length for one stream. Classification lives in
 * repair-risk-model; prompt rendering in repair-risk-tactic-section.
 */
import { prisma } from '../../../config/database';
import { queryEvents } from '../../memory/timeline';
import {
  REPAIR_RISK_CACHE_TTL_MS,
  repairRiskInputBounds,
  repairRiskWindowDays,
  type RepairRiskStream,
} from './repair-risk-constants';
import {
  buildRepairRiskSamples,
  computeRepairRiskBuckets,
  measuredInputChars,
  type ContextMetricRow,
  type RepairRiskTable,
  type RepairRiskTaskFacts,
  type RepairRiskTransitionRow,
} from './repair-risk-model';

const METRICS_EVENT = 'context_section_metrics';
const DAY_MS = 24 * 60 * 60 * 1000;

let cache: { table: RepairRiskTable; builtAt: number } | null = null;

/** Drop the cached table (tests / manual refresh). */
export function resetRepairRiskCache(): void {
  cache = null;
}

/**
 * Transitions inside the training window.
 *
 * @param windowDays - Window length. / 集計日数
 * @returns Rows ordered oldest first. / 遷移行
 */
export async function fetchRecentTransitionsForBuckets(
  windowDays: number,
): Promise<RepairRiskTransitionRow[]> {
  return prisma.workflowTransition.findMany({
    where: { createdAt: { gte: new Date(Date.now() - windowDays * DAY_MS) } },
    select: { taskId: true, cause: true, phase: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Parse one TimelineEvent into a metric row; null when the payload is not a
 * usable context_section_metrics payload.
 *
 * @param payload - Parsed or raw JSON payload. / イベントpayload
 * @param createdAt - Event time. / 記録時刻
 * @returns Metric row or null. / 計測行
 */
export function toMetricRow(payload: unknown, createdAt: Date): ContextMetricRow | null {
  let p: unknown = payload;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      return null;
    }
  }
  if (!p || typeof p !== 'object') return null;
  const { taskId, role, totalChars } = p as Record<string, unknown>;
  if (typeof taskId !== 'number' || typeof role !== 'string' || typeof totalChars !== 'number') {
    return null;
  }
  return { taskId, role, totalChars, createdAt };
}

async function fetchRecentMetrics(windowDays: number): Promise<ContextMetricRow[]> {
  const rows = await prisma.timelineEvent.findMany({
    where: {
      eventType: METRICS_EVENT,
      createdAt: { gte: new Date(Date.now() - windowDays * DAY_MS) },
    },
    select: { payload: true, createdAt: true },
  });
  const out: ContextMetricRow[] = [];
  for (const r of rows) {
    const row = toMetricRow(r.payload, r.createdAt);
    if (row) out.push(row);
  }
  return out;
}

async function fetchTaskFacts(taskIds: number[]): Promise<Map<number, RepairRiskTaskFacts>> {
  const facts = new Map<number, RepairRiskTaskFacts>();
  if (taskIds.length === 0) return facts;
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, complexityScore: true, description: true },
  });
  for (const t of tasks) {
    facts.set(t.id, {
      complexityScore: t.complexityScore ?? null,
      descriptionChars: (t.description ?? '').length,
    });
  }
  return facts;
}

/**
 * The cell table, rebuilt at most once per TTL. A task runs four phases within
 * minutes, so rebuilding per phase would repeat the same full-window scan.
 *
 * @returns Cell table. / セル表
 */
export async function getBucketTable(): Promise<RepairRiskTable> {
  const now = Date.now();
  if (cache && now - cache.builtAt < REPAIR_RISK_CACHE_TTL_MS) return cache.table;
  const windowDays = repairRiskWindowDays();
  const [transitions, metrics] = await Promise.all([
    fetchRecentTransitionsForBuckets(windowDays),
    fetchRecentMetrics(windowDays),
  ]);
  const facts = await fetchTaskFacts([...new Set(metrics.map((m) => m.taskId))]);
  const samples = buildRepairRiskSamples(transitions, metrics, facts);
  const table = computeRepairRiskBuckets(samples, repairRiskInputBounds());
  cache = { table, builtAt: now };
  return table;
}

/**
 * The decided complexity score of a task.
 *
 * @param taskId - Task id. / タスクID
 * @returns Score, or null when not decided. / 複雑度スコア
 */
export async function fetchTaskComplexity(taskId: number): Promise<number | null> {
  const row = await prisma.task.findUnique({
    where: { id: taskId },
    select: { complexityScore: true },
  });
  return row?.complexityScore ?? null;
}

/**
 * Input length a stream of this task is judged on. Falls back to the
 * description length when the prior phase was never measured, so detection
 * does not go dark on a first run.
 *
 * @param taskId - Task id. / タスクID
 * @param task - Task description holder. / タスク
 * @param stream - Phase about to run. / 実行段階
 * @returns Length and where it came from. / 入力長とその出所
 */
export async function resolveInputLength(
  taskId: number,
  task: { description: string | null },
  stream: RepairRiskStream,
): Promise<{
  chars: number;
  source: 'task_description' | 'prior_phase_metrics' | 'task_description_fallback';
}> {
  const descriptionChars = (task.description ?? '').length;
  if (stream === 'research') {
    return { chars: descriptionChars, source: 'task_description' };
  }
  // NOTE: queryEvents cannot filter on payload.role — the role filter is
  // applied here, client-side, over this task's events only.
  const { events } = await queryEvents({
    eventType: METRICS_EVENT,
    correlationId: `task_${taskId}`,
    limit: 200,
  });
  const rows: ContextMetricRow[] = [];
  for (const e of events) {
    const row = toMetricRow(e.payload, new Date(e.createdAt));
    if (row && row.taskId === taskId) rows.push(row);
  }
  const measured = measuredInputChars(stream, descriptionChars, rows);
  if (measured === null) return { chars: descriptionChars, source: 'task_description_fallback' };
  return { chars: measured, source: 'prior_phase_metrics' };
}

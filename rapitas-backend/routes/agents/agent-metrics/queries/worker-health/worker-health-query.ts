/**
 * Worker Health Query
 *
 * Builds the hourly worker-health series: four raw metrics per bucket, each
 * normalized against the same weekday+hour of the previous 4 weeks (median/MAD),
 * plus the weighted composite and detector results. Bucketing is done in the
 * application, not SQL, because SQLite and PostgreSQL disagree on date functions.
 */
import { prisma } from '../../../../../config/database';
import {
  countRestartsInRange,
  readWorkerRestartLog,
  type WorkerRestartLog,
} from '../../../../../services/agents/agent-worker/worker-restart-log';
import { compositeScore, robustZ } from './worker-health-baseline';
import {
  detectPeriodicityCollapse,
  detectRun,
  type PeriodicityDetection,
  type RunDetection,
} from './worker-health-detector';
import {
  FINISHED_EXECUTION_STATUSES,
  FINISHED_QUEUE_STATUSES,
  TIMEOUT_ERROR_KEYWORDS,
  WORKER_HEALTH_CONFIG,
  WORKER_HEALTH_METRIC_KEYS,
  WORKER_HEALTH_UNITS,
  type WorkerHealthMetricKey,
} from './worker-health-config';

export interface WorkerHealthExecutionRow {
  status: string;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface WorkerHealthQueueRow {
  status: string;
  retryCount: number;
  completedAt: Date | null;
}

export interface WorkerHealthPoint {
  /** Bucket start, ISO-8601 UTC. */
  t: string;
  raw: Record<WorkerHealthMetricKey, number | null>;
  /** Signed robust z (positive = above baseline); null = pending. */
  z: Record<WorkerHealthMetricKey, number | null>;
  composite: number | null;
}

export interface WorkerHealthSeries {
  unit: (typeof WORKER_HEALTH_UNITS)[number];
  bucketMs: number;
  generatedAt: string;
  recordingStartedAt: string | null;
  weights: Record<WorkerHealthMetricKey, number>;
  rules: {
    runThreshold: number;
    runLength: number;
    acfLowThreshold: number;
    acfMinDrop: number;
  };
  points: WorkerHealthPoint[];
}

export interface WorkerHealthResult extends WorkerHealthSeries {
  detection: { run: RunDetection; periodicity: PeriodicityDetection };
}

/**
 * Whether an error message marks a timeout.
 *
 * @param message - AgentExecution.errorMessage / エラーメッセージ
 * @returns true if it contains a timeout keyword / タイムアウトを示すか
 */
export function isTimeoutError(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return TIMEOUT_ERROR_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

interface BucketAcc {
  completions: number;
  finishedRuns: number;
  timeouts: number;
  finishedItems: number;
  retriedItems: number;
}

/**
 * Pure series builder. Only complete hours are emitted (the in-progress hour
 * would always look like a dip).
 *
 * @param input - Rows, restart log and clock / 入力行・再起動ログ・時刻
 * @returns Series with raw values, z-scores and composite per bucket
 */
export function buildWorkerHealthSeries(input: {
  executions: WorkerHealthExecutionRow[];
  queueItems: WorkerHealthQueueRow[];
  restartLog: WorkerRestartLog;
  now: Date;
}): WorkerHealthSeries {
  const { bucketMs, displayHours, baselineWeeks, weights, floors } = WORKER_HEALTH_CONFIG;
  const weekBuckets = (7 * 24 * 3_600_000) / bucketMs;
  const endIdx = Math.floor(input.now.getTime() / bucketMs); // exclusive: first incomplete bucket
  const firstDisplayIdx = endIdx - displayHours;
  const firstIdx = firstDisplayIdx - baselineWeeks * weekBuckets;

  const acc = new Map<number, BucketAcc>();
  const slot = (idx: number): BucketAcc => {
    let a = acc.get(idx);
    if (!a) {
      a = { completions: 0, finishedRuns: 0, timeouts: 0, finishedItems: 0, retriedItems: 0 };
      acc.set(idx, a);
    }
    return a;
  };
  const inRange = (idx: number) => idx >= firstIdx && idx < endIdx;

  for (const e of input.executions) {
    if (!e.completedAt) continue;
    const idx = Math.floor(e.completedAt.getTime() / bucketMs);
    if (!inRange(idx)) continue;
    const a = slot(idx);
    if (e.status === 'completed') a.completions++;
    if (FINISHED_EXECUTION_STATUSES.includes(e.status)) {
      a.finishedRuns++;
      if (e.status !== 'completed' && isTimeoutError(e.errorMessage)) a.timeouts++;
    }
  }
  for (const q of input.queueItems) {
    if (!q.completedAt || !FINISHED_QUEUE_STATUSES.includes(q.status)) continue;
    const idx = Math.floor(q.completedAt.getTime() / bucketMs);
    if (!inRange(idx)) continue;
    const a = slot(idx);
    a.finishedItems++;
    if (q.retryCount > 0) a.retriedItems++;
  }

  const rawAt = (idx: number): Record<WorkerHealthMetricKey, number | null> => {
    const a = acc.get(idx);
    const start = new Date(idx * bucketMs);
    const end = new Date((idx + 1) * bucketMs);
    return {
      completions: a?.completions ?? 0,
      // No finished runs in an hour means no timeouts, not an unknown rate.
      timeoutRate: a && a.finishedRuns > 0 ? a.timeouts / a.finishedRuns : 0,
      retryRate: a && a.finishedItems > 0 ? a.retriedItems / a.finishedItems : 0,
      restarts: countRestartsInRange(input.restartLog, start, end),
    };
  };

  const points: WorkerHealthPoint[] = [];
  for (let idx = firstDisplayIdx; idx < endIdx; idx++) {
    const raw = rawAt(idx);
    const baselineRaws = Array.from({ length: baselineWeeks }, (_, k) =>
      rawAt(idx - (k + 1) * weekBuckets),
    );
    const z = {} as Record<WorkerHealthMetricKey, number | null>;
    for (const key of WORKER_HEALTH_METRIC_KEYS) {
      z[key] = robustZ(
        raw[key],
        baselineRaws.map((r) => r[key]),
        floors[key],
      );
    }
    points.push({
      t: new Date(idx * bucketMs).toISOString(),
      raw,
      z,
      composite: compositeScore(z, weights),
    });
  }

  return {
    unit: WORKER_HEALTH_UNITS[0],
    bucketMs,
    generatedAt: input.now.toISOString(),
    recordingStartedAt: input.restartLog.recordingStartedAt?.toISOString() ?? null,
    weights: { ...weights },
    rules: {
      runThreshold: WORKER_HEALTH_CONFIG.runThreshold,
      runLength: WORKER_HEALTH_CONFIG.runLength,
      acfLowThreshold: WORKER_HEALTH_CONFIG.acfLowThreshold,
      acfMinDrop: WORKER_HEALTH_CONFIG.acfMinDrop,
    },
    points,
  };
}

/**
 * Apply both detectors to a built series.
 *
 * @param series - Series from buildWorkerHealthSeries / 系列
 * @returns Run and periodicity detections / 検出結果
 */
export function detectWorkerHealthDeviation(
  series: WorkerHealthSeries,
): WorkerHealthResult['detection'] {
  const composite = series.points.map((p) => p.composite);
  return {
    run: detectRun(composite, WORKER_HEALTH_CONFIG.runThreshold, WORKER_HEALTH_CONFIG.runLength),
    periodicity: detectPeriodicityCollapse(composite),
  };
}

/**
 * Load rows for the window and build the series with detections.
 *
 * @param opts - Clock and restart log overrides for tests / テスト用の上書き
 * @returns Series plus detection results / 系列と検出結果
 */
export async function getWorkerHealth(
  opts: { now?: Date; restartLog?: WorkerRestartLog } = {},
): Promise<WorkerHealthResult> {
  const now = opts.now ?? new Date();
  const { bucketMs, displayHours, baselineWeeks } = WORKER_HEALTH_CONFIG;
  const since = new Date(
    Math.floor(now.getTime() / bucketMs) * bucketMs -
      (displayHours + baselineWeeks * 7 * 24) * bucketMs,
  );

  const [executions, queueItems] = await Promise.all([
    prisma.agentExecution.findMany({
      where: { completedAt: { gte: since } },
      select: { status: true, completedAt: true, errorMessage: true },
    }),
    prisma.workflowQueueItem.findMany({
      where: { completedAt: { gte: since } },
      select: { status: true, retryCount: true, completedAt: true },
    }),
  ]);

  const series = buildWorkerHealthSeries({
    executions,
    queueItems,
    restartLog: opts.restartLog ?? readWorkerRestartLog(),
    now,
  });
  return { ...series, detection: detectWorkerHealthDeviation(series) };
}

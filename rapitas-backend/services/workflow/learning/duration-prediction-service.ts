/**
 * Duration Prediction Service
 *
 * Computes distribution-based task duration predictions (median / IQR /
 * sample size / confidence) from per-task WorkflowLearningRecord completion
 * rows, persists one prediction row per task, and resolves the prediction
 * error when the task completes. Returns "unpredictable" instead of
 * fabricating numbers when history is below the sample threshold.
 * All persistence is fail-open: a prediction failure never breaks callers.
 */
import { taskScopedRecordWhere } from './task-scoped-records';
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';

const log = createLogger('duration-prediction');

/** Default minimum completion-row count required to emit a prediction. */
const DEFAULT_MIN_SAMPLES = 5;
/** Sample count at which the confidence sample factor saturates at 1. */
const TARGET_SAMPLES = 20;
/** Most-recent completion rows scanned per grouping (bounds the query). */
const RECENT_SAMPLE_LIMIT = 100;
/** Lower clamp for the spread factor (also used when median <= 0). */
const MIN_SPREAD_FACTOR = 0.2;

/** Distribution-based duration prediction for one task grouping. */
export interface DurationPrediction {
  /** Whether history met the sample threshold (false = do not trust numbers). */
  predictable: boolean;
  /** Number of completion rows in the population. */
  sampleSize: number;
  /** Median duration in minutes, or null when unpredictable. */
  medianMinutes: number | null;
  /** First quartile (nearest-rank) in minutes, or null when unpredictable. */
  p25Minutes: number | null;
  /** Third quartile (nearest-rank) in minutes, or null when unpredictable. */
  p75Minutes: number | null;
  /** Confidence score 0-1 (0 when unpredictable). */
  confidence: number;
  /** Population identifier, e.g. "theme:12|mode:standard". */
  groupingKey: string;
}

/** Prediction row shape as stored in TaskDurationPrediction. */
interface TaskDurationPredictionRow {
  taskId: number;
  groupingKey: string;
  predictable: boolean;
  sampleSize: number;
  medianMinutes: number | null;
  p25Minutes: number | null;
  p75Minutes: number | null;
  confidence: number;
  actualDurationMinutes: number | null;
  errorMinutes: number | null;
  errorRatio: number | null;
}

/** Prediction-time fields written on upsert (error fields stay untouched). */
interface TaskDurationPredictionWrite {
  groupingKey: string;
  predictable: boolean;
  sampleSize: number;
  medianMinutes: number | null;
  p25Minutes: number | null;
  p75Minutes: number | null;
  confidence: number;
  predictedAt: Date;
}

interface TaskDurationPredictionDelegate {
  findUnique(args: { where: { taskId: number } }): Promise<TaskDurationPredictionRow | null>;
  upsert(args: {
    where: { taskId: number };
    create: TaskDurationPredictionWrite & { taskId: number };
    update: TaskDurationPredictionWrite;
  }): Promise<unknown>;
  update(args: {
    where: { taskId: number };
    data: {
      actualDurationMinutes: number;
      errorMinutes: number;
      errorRatio: number | null;
      resolvedAt: Date;
    };
  }): Promise<unknown>;
}

/**
 * Resolve the TaskDurationPrediction delegate off the shared prisma client.
 *
 * HACK(agent): taskDurationPrediction is not yet in PrismaClient typings until
 * `prisma generate` runs after server restart. Access via record cast to avoid
 * a compile error before restart (same pattern as git-retry-telemetry.ts).
 *
 * @returns The delegate, or undefined while the regenerated client is pending. / デリゲートまたは未生成時undefined
 */
function resolvePredictionDelegate(): TaskDurationPredictionDelegate | undefined {
  return (prisma as unknown as Record<string, unknown>)['taskDurationPrediction'] as
    | TaskDurationPredictionDelegate
    | undefined;
}

/**
 * Resolve the minimum sample threshold (env-overridable).
 *
 * @param env - Env source (injectable for tests). / 環境変数ソース
 * @returns Threshold count (>= 1), default 5. / 閾値件数（既定5）
 */
function resolveMinSamples(env: NodeJS.ProcessEnv = process.env): number {
  const raw = parseInt(env.RAPITAS_PREDICTION_MIN_SAMPLES ?? '', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_MIN_SAMPLES;
}

/**
 * Median of a sorted ascending array: middle value for odd n, rounded mean of
 * the two middle values for even n.
 */
function computeMedian(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
}

/** Nearest-rank percentile (1-based rank): sorted[ceil(p * n) - 1]. */
function nearestRank(sorted: number[], p: number): number {
  return sorted[Math.ceil(p * sorted.length) - 1];
}

/**
 * Confidence = sampleFactor * spreadFactor, rounded to 2 decimals.
 * sampleFactor = min(1, n / TARGET_SAMPLES); spreadFactor = clamp(1 - IQR /
 * median, 0.2, 1) with the 0.2 floor also applied when median <= 0.
 */
function computeConfidence(n: number, median: number, p25: number, p75: number): number {
  const sampleFactor = Math.min(1, n / TARGET_SAMPLES);
  const spreadFactor =
    median <= 0
      ? MIN_SPREAD_FACTOR
      : Math.min(1, Math.max(MIN_SPREAD_FACTOR, 1 - (p75 - p25) / median));
  return Math.round(sampleFactor * spreadFactor * 100) / 100;
}

/**
 * Compute a distribution-based duration prediction for a theme x mode grouping.
 *
 * Only per-task completion rows written by recordWorkflowCompletion are used;
 * per-execution rows written by recordWorkflowExecution are excluded via
 * `estimatedDuration: { not: null }` (that writer never sets the column), with
 * `complexityFactors: { not: '{}' }` as belt-and-suspenders — mixing the two
 * row kinds would bimodalize the distribution and skew the median short.
 *
 * @param themeId - Theme to scope the population (null = cross-theme). / 母集団を絞るテーマID（null=全テーマ）
 * @param mode - Workflow mode string (e.g. "standard"). / ワークフローモード文字列
 * @returns Prediction with predictable=false (all numbers null/0) below the sample threshold. / 閾値未満はpredictable=falseの予測
 */
export async function computeDurationPrediction(
  themeId: number | null,
  mode: string,
): Promise<DurationPrediction> {
  const where: Record<string, unknown> = {
    workflowMode: mode,
    success: true,
    actualDurationMinutes: { not: null },
    ...taskScopedRecordWhere(),
  };
  if (themeId) {
    where.themeId = themeId;
  }
  const groupingKey = `theme:${themeId ?? 'all'}|mode:${mode}`;

  const records = await prisma.workflowLearningRecord.findMany({
    where,
    select: { actualDurationMinutes: true },
    orderBy: { createdAt: 'desc' },
    take: RECENT_SAMPLE_LIMIT,
  });

  const durations = records
    .map((r) => r.actualDurationMinutes)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const n = durations.length;

  if (n < resolveMinSamples()) {
    // NOTE: below the threshold we return "unpredictable" with null stats —
    // never a fabricated fallback value (unlike estimateDurationFromHistory).
    return {
      predictable: false,
      sampleSize: n,
      medianMinutes: null,
      p25Minutes: null,
      p75Minutes: null,
      confidence: 0,
      groupingKey,
    };
  }

  const medianMinutes = computeMedian(durations);
  const p25Minutes = nearestRank(durations, 0.25);
  const p75Minutes = nearestRank(durations, 0.75);

  return {
    predictable: true,
    sampleSize: n,
    medianMinutes,
    p25Minutes,
    p75Minutes,
    confidence: computeConfidence(n, medianMinutes, p25Minutes, p75Minutes),
    groupingKey,
  };
}

/**
 * Compute a task's duration prediction and persist it (upsert by taskId).
 *
 * Fail-open: any error is logged and swallowed; when the regenerated Prisma
 * client is not available yet (pending server restart) the prediction is
 * still computed and returned, just not persisted.
 *
 * @param taskId - Task to predict for. / 予測対象のタスクID
 * @returns The computed prediction, or null when the task is missing or on error. / 算出した予測またはnull
 */
export async function predictAndPersistTaskDuration(
  taskId: number,
): Promise<DurationPrediction | null> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { themeId: true, workflowMode: true },
    });
    if (!task) return null;

    const prediction = await computeDurationPrediction(
      task.themeId,
      task.workflowMode || 'comprehensive',
    );

    const delegate = resolvePredictionDelegate();
    if (!delegate) {
      log.debug({ taskId }, 'taskDurationPrediction model not yet available (pending restart)');
      return prediction;
    }

    const write: TaskDurationPredictionWrite = {
      groupingKey: prediction.groupingKey,
      predictable: prediction.predictable,
      sampleSize: prediction.sampleSize,
      medianMinutes: prediction.medianMinutes,
      p25Minutes: prediction.p25Minutes,
      p75Minutes: prediction.p75Minutes,
      confidence: prediction.confidence,
      predictedAt: new Date(),
    };
    // NOTE: update writes prediction-time fields only, so a re-prediction never
    // clears a previously resolved actual/error measurement.
    await delegate.upsert({
      where: { taskId },
      create: { taskId, ...write },
      update: write,
    });

    return prediction;
  } catch (error) {
    log.warn({ err: error, taskId }, 'duration prediction failed (non-fatal)');
    return null;
  }
}

/**
 * Resolve the prediction error for a completed task (fail-open).
 *
 * No-op when the task has no prediction row, the row is unpredictable, or no
 * actual duration is available — errors are only recorded against a real,
 * numeric prediction (never fabricated).
 *
 * @param taskId - Completed task. / 完了したタスクID
 * @param actualDurationMinutes - Measured duration, null when unknown. / 実測所要時間（分）、不明時null
 */
export async function recordDurationPredictionError(
  taskId: number,
  actualDurationMinutes: number | null,
): Promise<void> {
  try {
    if (actualDurationMinutes === null) return;

    const delegate = resolvePredictionDelegate();
    if (!delegate) {
      log.debug({ taskId }, 'taskDurationPrediction model not yet available (pending restart)');
      return;
    }

    const row = await delegate.findUnique({ where: { taskId } });
    if (!row || !row.predictable || row.medianMinutes === null) return;

    await delegate.update({
      where: { taskId },
      data: {
        actualDurationMinutes,
        errorMinutes: actualDurationMinutes - row.medianMinutes,
        // NOTE: guard against division by zero — ratio is undefined for a 0-minute median.
        errorRatio: row.medianMinutes > 0 ? actualDurationMinutes / row.medianMinutes : null,
        resolvedAt: new Date(),
      },
    });
  } catch (error) {
    log.warn({ err: error, taskId }, 'duration prediction error recording failed (non-fatal)');
  }
}

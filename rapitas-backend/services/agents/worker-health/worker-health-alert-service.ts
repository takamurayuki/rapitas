/**
 * Worker Health Alert Service
 *
 * Periodically evaluates the worker-health series and raises one in-app
 * notification per deviation episode. Not responsible for computing the series
 * (routes/agents/agent-metrics/queries/worker-health) or for rendering.
 *
 * NOTE: the original idea asked for Prometheus/Alertmanager rules; the
 * repository has no such stack, so the rules run here and notify through the
 * existing Notification pipeline instead.
 */
import { createLogger } from '../../../config/logger';
import { prisma } from '../../../config/database';
import { createNotification } from '../../communication/notification-service';
import { buildNotificationI18n } from '../../communication/notification-i18n';
import {
  getWorkerHealth,
  WORKER_HEALTH_CONFIG,
  type WorkerHealthMetricKey,
  type WorkerHealthResult,
} from '../../../routes/agents/agent-metrics/queries/worker-health';
import { WORKER_HEALTH_METRIC_KEYS } from '../../../routes/agents/agent-metrics/queries/worker-health/worker-health-config';
import { ensureRestartRecordingStarted } from '../agent-worker/worker-restart-log';

const logger = createLogger('worker-health-alert');

export type WorkerHealthAlertKind = 'run' | 'periodicity';

export interface WorkerHealthAlert {
  kind: WorkerHealthAlertKind;
  metric: WorkerHealthMetricKey;
  /** Bucket start (ISO) the alert points at. */
  at: string;
  composite: number | null;
  episodeKey: string;
}

interface NotifyArgs {
  title: string;
  message: string;
  link: string;
  episodeKey: string;
  alert: WorkerHealthAlert;
}

export interface WorkerHealthAlertDeps {
  loadResult: (now: Date) => Promise<WorkerHealthResult>;
  notify: (args: NotifyArgs) => Promise<void>;
}

const METRIC_LABEL: Record<WorkerHealthMetricKey, string> = {
  completions: '実行完了数',
  timeoutRate: 'タイムアウト率',
  retryRate: '再試行率',
  restarts: 'ワーカー再起動数',
};

const KIND_LABEL: Record<WorkerHealthAlertKind, string> = {
  run: '複合スコアが連続して逸脱',
  periodicity: '日次周期（自己相関）の崩れ',
};

/**
 * Deep link from an alert to the per-metric breakdown on the metrics page.
 *
 * @param metric - Metric to highlight / 強調する指標
 * @param at - Bucket start ISO time / 該当バケット時刻
 * @returns App-relative URL / アプリ内リンク
 */
export function buildWorkerHealthLink(metric: WorkerHealthMetricKey, at: string): string {
  return `/agents/metrics?panel=worker-health&metric=${metric}&at=${encodeURIComponent(at)}`;
}

/** The metric contributing most weighted deterioration over points[from..to]. */
function dominantMetric(
  result: WorkerHealthResult,
  from: number,
  to: number,
): WorkerHealthMetricKey {
  const totals = {} as Record<WorkerHealthMetricKey, number>;
  for (const key of WORKER_HEALTH_METRIC_KEYS) totals[key] = 0;
  for (let i = Math.max(0, from); i <= to && i < result.points.length; i++) {
    const z = result.points[i].z;
    for (const key of WORKER_HEALTH_METRIC_KEYS) {
      const v = z[key];
      if (v === null) continue;
      const bad = key === 'completions' ? -v : v;
      totals[key] += result.weights[key] * Math.min(Math.max(bad, 0), WORKER_HEALTH_CONFIG.zClip);
    }
  }
  return WORKER_HEALTH_METRIC_KEYS.reduce((best, k) => (totals[k] > totals[best] ? k : best));
}

/**
 * Build an evaluator that remembers which episodes are active so a continuing
 * deviation notifies once and re-arms only after it resolves.
 *
 * @param deps - Loader and notifier (injectable) / 依存の注入
 * @returns Evaluator with evaluate(now) returning newly raised alerts
 */
export function createWorkerHealthAlertEvaluator(deps: WorkerHealthAlertDeps) {
  const active = new Set<string>();

  return {
    /**
     * Evaluate once.
     *
     * @param now - Clock / 現在時刻
     * @returns Alerts newly raised by this evaluation / 今回新規に発火した逸脱
     */
    async evaluate(now: Date): Promise<WorkerHealthAlert[]> {
      const result = await deps.loadResult(now);
      const lastIdx = result.points.length - 1;
      const raised: WorkerHealthAlert[] = [];
      if (lastIdx < 0) return raised;

      const candidates: Array<{
        kind: WorkerHealthAlertKind;
        metric: WorkerHealthMetricKey;
        from: number;
      }> = [];
      const lastComposite = result.points[lastIdx].composite;
      // Only a run still open at the newest point is "now"; older runs are history.
      if (
        result.detection.run.fired &&
        result.detection.run.endIndex === lastIdx &&
        lastComposite !== null
      ) {
        let from = lastIdx;
        while (
          from > 0 &&
          (result.points[from - 1].composite ?? -1) >= WORKER_HEALTH_CONFIG.runThreshold
        ) {
          from--;
        }
        candidates.push({ kind: 'run', metric: dominantMetric(result, from, lastIdx), from });
      }
      if (result.detection.periodicity.fired) {
        const from = lastIdx - WORKER_HEALTH_CONFIG.acfLagBuckets + 1;
        candidates.push({
          kind: 'periodicity',
          metric: dominantMetric(result, from, lastIdx),
          from,
        });
      }

      const stillActive = new Set<string>();
      for (const c of candidates) {
        const episodeKey = `${c.metric}:${c.kind}`;
        stillActive.add(episodeKey);
        if (active.has(episodeKey)) continue;
        const at = result.points[lastIdx].t;
        const alert: WorkerHealthAlert = {
          kind: c.kind,
          metric: c.metric,
          at,
          composite: lastComposite,
          episodeKey,
        };
        // Mark first: a failed notify must not turn into a notification storm every 15 min.
        active.add(episodeKey);
        await deps.notify({
          title: 'ワーカー健全性: ベースラインからの逸脱を検知',
          message: `${KIND_LABEL[c.kind]}しています。主な寄与指標: ${METRIC_LABEL[c.metric]}（複合スコア ${
            lastComposite === null ? '-' : lastComposite.toFixed(2)
          }）。個別指標で根拠を確認してください。`,
          link: buildWorkerHealthLink(c.metric, at),
          episodeKey,
          alert,
        });
        raised.push(alert);
      }
      // Resolved episodes re-arm.
      for (const key of [...active]) if (!stillActive.has(key)) active.delete(key);
      return raised;
    },
  };
}

/** Default notifier: one unread notification per episode key. */
async function notifyViaNotificationPipeline(args: NotifyArgs): Promise<void> {
  const dedupKey = `worker_health_deviation:${args.episodeKey}`;
  const existing = await prisma.notification.findFirst({
    where: {
      type: 'worker_health_deviation',
      isRead: false,
      metadata: { contains: `"dedupKey":"${dedupKey}"` },
    },
    select: { id: true },
  });
  if (existing) return;
  await createNotification({
    type: 'worker_health_deviation',
    title: args.title,
    message: args.message,
    link: args.link,
    metadata: { dedupKey, kind: args.alert.kind, metric: args.alert.metric },
    i18n: buildNotificationI18n('worker_health_deviation', {
      reason: KIND_LABEL[args.alert.kind],
      metric: METRIC_LABEL[args.alert.metric],
      score: args.alert.composite === null ? '-' : args.alert.composite.toFixed(2),
    }),
  });
}

/**
 * Run one evaluation, logging instead of throwing so the next tick proceeds.
 *
 * @param evaluator - Evaluator to run / 評価器
 * @param now - Clock / 現在時刻
 */
export async function runWorkerHealthEvaluationTick(
  evaluator: { evaluate: (now: Date) => Promise<WorkerHealthAlert[]> },
  now: Date = new Date(),
): Promise<void> {
  try {
    const raised = await evaluator.evaluate(now);
    if (raised.length > 0) {
      logger.warn({ alerts: raised.map((a) => a.episodeKey) }, 'Worker health deviation detected');
    }
  } catch (err) {
    logger.error({ err }, 'Worker health evaluation failed; will retry next tick');
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic evaluation (idempotent). Also stamps the restart-log
 * recording start so the restart metric becomes known from this moment.
 */
export function startWorkerHealthAlertScheduler(): void {
  if (timer) return;
  try {
    ensureRestartRecordingStarted();
  } catch (err) {
    logger.warn({ err }, 'Could not initialise worker restart log');
  }
  const evaluator = createWorkerHealthAlertEvaluator({
    loadResult: (now) => getWorkerHealth({ now }),
    notify: notifyViaNotificationPipeline,
  });
  void runWorkerHealthEvaluationTick(evaluator);
  timer = setInterval(
    () => void runWorkerHealthEvaluationTick(evaluator),
    WORKER_HEALTH_CONFIG.evaluationIntervalMs,
  );
  timer.unref?.();
}

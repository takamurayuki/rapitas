/**
 * worker-health-focus
 *
 * Parses the deep-link query (`?panel=worker-health&metric=<key>&at=<ISO>`)
 * that worker-health alerts carry into the metrics page. Pure; no React.
 */
import { WORKER_HEALTH_METRIC_ORDER, type WorkerHealthMetricKey } from '../_hooks/useWorkerHealth';

export interface WorkerHealthFocus {
  panel: 'worker-health';
  metric: WorkerHealthMetricKey | null;
  at: string | null;
}

/**
 * Interpret the alert deep-link query.
 *
 * @param params - Query accessor (e.g. URLSearchParams) / クエリ
 * @returns Focus request, or null when the link does not target the worker-health panel
 */
export function parseWorkerHealthFocus(params: {
  get: (key: string) => string | null;
}): WorkerHealthFocus | null {
  if (params.get('panel') !== 'worker-health') return null;
  const metric = params.get('metric');
  const at = params.get('at');
  return {
    panel: 'worker-health',
    metric: WORKER_HEALTH_METRIC_ORDER.find((m) => m === metric) ?? null,
    at: at && !Number.isNaN(new Date(at).getTime()) ? at : null,
  };
}

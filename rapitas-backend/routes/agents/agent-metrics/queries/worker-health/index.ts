/**
 * Worker Health Query — barrel
 *
 * Re-exports the public API of the worker-health module.
 */

export type {
  WorkerHealthPoint,
  WorkerHealthSeries,
  WorkerHealthResult,
} from './worker-health-query';
export {
  buildWorkerHealthSeries,
  detectWorkerHealthDeviation,
  getWorkerHealth,
  isTimeoutError,
} from './worker-health-query';
export { WORKER_HEALTH_CONFIG, WORKER_HEALTH_UNITS } from './worker-health-config';
export type { WorkerHealthMetricKey } from './worker-health-config';

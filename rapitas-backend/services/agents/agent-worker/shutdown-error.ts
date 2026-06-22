/**
 * shutdown-error (agent-worker layer re-export)
 *
 * Re-exports shutdown error utilities from the canonical common module.
 * The worker layer's SHUTDOWN_ERROR_MESSAGE is aliased from
 * WORKER_SHUTDOWN_ERROR_MESSAGE ('Manager is shutting down') to preserve the
 * existing name used by worker-shutdown.ts and all consumers in this layer.
 *
 * NOTE: SHUTDOWN_ERROR_MESSAGE exported here ('Manager is shutting down') differs
 * from the same-named export in orchestrator/shutdown-error.ts ('Server is shutting
 * down'). This intentional dual-naming reflects that the two layers throw distinct
 * error strings. / worker 層とorchestrator 層は別の文字列を throw するため、
 * 同じ識別子名でも値が異なる点に注意。
 */
export {
  WORKER_SHUTDOWN_ERROR_MESSAGE as SHUTDOWN_ERROR_MESSAGE,
  isShutdownError,
} from '../../../utils/common/shutdown-error';

/**
 * shutdown-error (orchestrator layer re-export)
 *
 * Re-exports shutdown error utilities from the canonical common module so that
 * all orchestrator consumers can continue importing from this path without change.
 * The single implementation lives in `utils/common/shutdown-error.ts`.
 */
export {
  SHUTDOWN_ERROR_MESSAGE,
  buildShutdownErrorMessage,
  isShutdownError,
} from '../../../utils/common/shutdown-error';

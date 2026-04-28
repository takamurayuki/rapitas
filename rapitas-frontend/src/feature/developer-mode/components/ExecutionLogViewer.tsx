/**
 * ExecutionLogViewer.tsx
 *
 * Backward-compatibility re-export shim.
 * The implementation has been split into execution-log-viewer/.
 * Import from this file or from execution-log-viewer/ — both are stable.
 */

export { ExecutionLogViewer, default, formatLogLine } from './execution-log-viewer';

export type {
  ExecutionLogStatus,
  ExecutionLogViewMode,
  ExecutionLogViewerProps,
} from './execution-log-viewer';

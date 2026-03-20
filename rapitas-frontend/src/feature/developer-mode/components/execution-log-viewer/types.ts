/**
 * execution-log-viewer/types.ts
 *
 * Shared type definitions for the ExecutionLogViewer component family.
 * Does not contain any component or utility logic.
 */

export type ExecutionLogStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExecutionLogViewMode = 'simple' | 'detailed';

export type ExecutionLogViewerProps = {
  /** Array of execution log lines */
  logs: string[];
  /** Execution status */
  status: ExecutionLogStatus;
  /** SSE connection state */
  isConnected?: boolean;
  /** Whether running */
  isRunning?: boolean;
  /** Whether to expand on initial display */
  defaultExpanded?: boolean;
  /** Whether to start in fullscreen mode */
  defaultFullscreen?: boolean;
  /** Default view mode */
  defaultViewMode?: ExecutionLogViewMode;
  /** Custom class name */
  className?: string;
  /** Whether collapsible */
  collapsible?: boolean;
  /** Whether to show header */
  showHeader?: boolean;
  /** Max log height in pixels */
  maxHeight?: number;
};

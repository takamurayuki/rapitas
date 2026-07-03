/**
 * execution-log-viewer/types.ts
 *
 * Shared type definitions for the ExecutionLogViewer component family.
 * Does not contain any component or utility logic.
 */

export type ExecutionLogStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * @deprecated The viewer no longer has a mode toggle — it always renders the
 * formatted (icon-based) log. Kept only for barrel-export backward compatibility.
 */
export type ExecutionLogViewMode = 'simple' | 'detailed';

export type ExecutionLogViewerProps = {
  /** Array of execution log lines */
  logs: string[];
  /** Execution status */
  status: ExecutionLogStatus;
  /**
   * SSE connection state. Accepted for backward compatibility but no longer
   * rendered — the "LIVE" streaming indicator was removed. Kept so existing
   * callers compile unchanged.
   */
  isConnected?: boolean;
  /** Whether running */
  isRunning?: boolean;
  /** Whether to expand on initial display */
  defaultExpanded?: boolean;
  /** Whether to start in fullscreen mode */
  defaultFullscreen?: boolean;
  /** Custom class name */
  className?: string;
  /** Whether collapsible */
  collapsible?: boolean;
  /** Whether to show header */
  showHeader?: boolean;
  /** Max log height in pixels */
  maxHeight?: number;
  /** Task id — shown in the header as `Task #<id>` so it's easy to reference/share. */
  taskId?: number;
};

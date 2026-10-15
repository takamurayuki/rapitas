/**
 * workflow-queue.types
 *
 * Type definitions for WorkflowQueueService. Extracted from workflow-queue.ts
 * (file-size split); contains no logic.
 */

export interface QueueItem {
  id: number;
  taskId: number;
  orchestraSessionId: number | null;
  priority: number;
  status: string;
  currentPhase: string;
  dependencies: number[];
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface EnqueueOptions {
  taskId: number;
  priority?: number;
  dependencies?: number[];
  orchestraSessionId?: number;
  /** Set by the theme auto-run scheduler to scope concurrency and completion tracking. */
  themeId?: number;
}

export interface QueueState {
  queued: QueueItem[];
  running: QueueItem[];
  waitingApproval: QueueItem[];
  completed: QueueItem[];
  failed: QueueItem[];
  totalItems: number;
  maxConcurrency: number;
}

/** Raw DB row shape mapToQueueItem converts to a QueueItem. */
export interface WorkflowQueueItemRow {
  id: number;
  taskId: number;
  orchestraSessionId: number | null;
  priority: number;
  status: string;
  currentPhase: string;
  dependencies: string;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

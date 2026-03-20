/**
 * orchestra/types
 *
 * Shared TypeScript interfaces for the Orchestra page and its sub-components.
 * Contains no React or runtime code.
 */

export interface QueueItemTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  workflowStatus: string | null;
  workflowMode: string | null;
  theme: { id: number; name: string; color: string } | null;
}

export interface QueueItem {
  id: number;
  taskId: number;
  priority: number;
  status: string;
  currentPhase: string;
  dependencies: number[];
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  task: QueueItemTask | null;
}

export interface OrchestraState {
  session: {
    id: number;
    status: string;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    startedAt: string | null;
  } | null;
  runner: {
    isRunning: boolean;
    activeItems: number;
    processedTotal: number;
  };
  queue: {
    queued: number;
    running: number;
    waitingApproval: number;
    completed: number;
    failed: number;
  };
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

export interface AvailableTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  workflowStatus: string | null;
  theme: { name: string } | null;
}

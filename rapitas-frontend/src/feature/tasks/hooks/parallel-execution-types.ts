/**
 * parallel-execution-types
 *
 * Shared types and interfaces for the parallel execution status feature.
 * Does not contain any React hooks or side effects.
 */

import type { ParallelExecutionStatus } from '../components/SubtaskExecutionStatus';

/**
 * Subtask execution status
 */
export interface SubtaskExecutionState {
  taskId: number;
  status: ParallelExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  executionTimeMs?: number;
  tokensUsed?: number;
  error?: string;
}

/**
 * Parallel execution session state
 */
export interface ParallelSessionState {
  sessionId: string;
  status: ParallelExecutionStatus;
  progress: number;
  currentLevel: number;
  completedTasks: number[];
  runningTasks: number[];
  pendingTasks: number[];
  failedTasks: number[];
  blockedTasks: number[];
  subtaskStates: Map<number, SubtaskExecutionState>;
  totalTokensUsed: number;
  totalExecutionTimeMs: number;
}

/**
 * SSE event type from the parallel execution backend stream
 */
export interface ParallelExecutionEvent {
  type:
    | 'session_started'
    | 'session_completed'
    | 'session_failed'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'level_started'
    | 'level_completed'
    | 'progress_updated';
  sessionId: string;
  taskId?: number;
  level?: number;
  data?: {
    executionTimeMs?: number;
    tokensUsed?: number;
    errorMessage?: string;
    progress?: number;
    completed?: number[];
    running?: number[];
    pending?: number[];
    failed?: number[];
    blocked?: number[];
  };
  timestamp: string;
}

export interface UseParallelExecutionStatusOptions {
  /** Task ID */
  taskId: number;
  /** Whether to enable SSE connection */
  enableSSE?: boolean;
  /** Polling interval in milliseconds */
  pollingInterval?: number;
}

export interface UseParallelExecutionStatusReturn {
  /** Session ID */
  sessionId: string | null;
  /** Session state */
  sessionState: ParallelSessionState | null;
  /** Whether connected */
  isConnected: boolean;
  /** Whether running */
  isRunning: boolean;
  /** Error */
  error: string | null;
  /** Get subtask execution status */
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  /** Start session */
  startSession: (config?: {
    maxConcurrentAgents?: number;
  }) => Promise<string | null>;
  /** Stop session */
  stopSession: () => Promise<void>;
  /** Update status (manual) */
  refreshStatus: () => Promise<void>;
}

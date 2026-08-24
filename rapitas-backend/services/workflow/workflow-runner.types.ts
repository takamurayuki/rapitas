/**
 * workflow-runner.types
 *
 * Type definitions for WorkflowRunner. Extracted from workflow-runner.ts
 * (file-size split); contains no logic.
 */

export interface RunnerStatus {
  isRunning: boolean;
  activeItems: number;
  processedTotal: number;
  pollIntervalMs: number;
}

export interface ActiveExecution {
  queueItemId: number;
  taskId: number;
  startedAt: Date;
  currentPhase: string;
  abortController: AbortController;
}

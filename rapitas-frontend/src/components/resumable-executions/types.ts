/**
 * resumable-executions/types
 *
 * Shared TypeScript types for the ResumableExecutionsBanner feature.
 * No runtime logic — types only.
 */

export type ResumableExecution = {
  id: number;
  taskId: number;
  taskTitle: string;
  sessionId: number;
  status: string;
  claudeSessionId: string | null;
  errorMessage: string | null;
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  workingDirectory: string | null;
  canResume: boolean;
};

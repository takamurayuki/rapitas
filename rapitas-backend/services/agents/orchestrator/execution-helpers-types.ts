/**
 * Execution Helpers Types
 *
 * Type definitions for execution helpers shared across orchestrator modules.
 */
import type { BaseAgent } from '../base-agent';
import type { QuestionKey } from '../question-detection';
import type { ExecutionFileLogger } from '../execution-file-logger';
import type {
  ExecutionState,
  OrchestratorEvent,
  ActiveAgentInfo,
  PrismaClientInstance,
} from './types';

export type { ActiveAgentInfo } from './types';

/**
 * Context required for setting up question detection handler.
 */
export type QuestionHandlerContext = {
  prisma: PrismaClientInstance;
  executionId: number;
  sessionId: number;
  taskId: number;
  state: ExecutionState;
  fileLogger: ExecutionFileLogger;
  existingClaudeSessionId?: string | null;
  emitEvent: (event: OrchestratorEvent) => void;
  startQuestionTimeout: (executionId: number, taskId: number, questionKey?: QuestionKey) => void;
  getQuestionTimeoutInfo: (
    executionId: number,
  ) => { remainingSeconds: number; deadline: Date; questionKey?: QuestionKey } | null;
};

/**
 * Context required for setting up output handler.
 */
export type OutputHandlerContext = {
  prisma: PrismaClientInstance;
  executionId: number;
  sessionId: number;
  taskId: number;
  state: ExecutionState;
  agentInfo: ActiveAgentInfo;
  fileLogger: ExecutionFileLogger;
  onOutput?: (output: string, isError?: boolean) => void;
  emitEvent: (event: OrchestratorEvent) => void;
};

/**
 * Context for log management.
 */
export type LogManagerContext = {
  prisma: PrismaClientInstance;
  executionId: number;
  initialSequenceNumber: number;
};

/**
 * Execution result type used across helper modules.
 */
export type ExecutionResult = {
  success: boolean;
  waitingForInput?: boolean;
  output?: string;
  artifacts?: unknown;
  tokensUsed?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  question?: string;
  questionType?: string;
  questionDetails?: unknown;
  claudeSessionId?: string;
  questionKey?: QuestionKey;
  commits?: Array<{
    hash: string;
    message: string;
    branch?: string;
    filesChanged?: number;
    additions?: number;
    deletions?: number;
  }>;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  modelName?: string;
};

/**
 * Existing execution data for updates.
 */
export type ExistingExecutionData = {
  artifacts?: string | null;
  tokensUsed?: number | null;
  executionTimeMs?: number | null;
  claudeSessionId?: string | null;
};

/**
 * Convert value to JSON string or null.
 */
export function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

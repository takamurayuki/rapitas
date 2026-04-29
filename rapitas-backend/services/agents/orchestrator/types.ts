/**
 * Orchestrator Shared Type Definitions
 *
 * All types used across orchestrator modules are centralized here
 * to prevent circular dependencies.
 */
import { PrismaClient } from '@prisma/client';
export type PrismaClientInstance = InstanceType<typeof PrismaClient>;

import type { AgentOutputHandler, AgentStatus, TaskAnalysisInfo, BaseAgent } from '../base-agent';
import type { QuestionKey } from '../question-detection';
import type { ExecutionFileLogger } from '../execution-file-logger';
import type { AgentConfigInput } from '../agent-factory';

export type ExecutionOptions = {
  taskId: number;
  sessionId: number;
  agentConfigId?: number;
  workingDirectory?: string;
  timeout?: number;
  requireApproval?: boolean;
  onOutput?: AgentOutputHandler;
  /** AI task analysis result (passed when analysis is enabled). */
  analysisInfo?: TaskAnalysisInfo;
  /** Flag indicating continuation from a previous execution. */
  continueFromPrevious?: boolean;
  branchName?: string;
  /** Override the DB-configured model for this execution only. */
  modelIdOverride?: string;
  /** When false, successful execution does not mark Task.status as done. */
  autoCompleteTask?: boolean;
  /**
   * Internal: when set, the executor will not retry on provider failure.
   * Used by the fallback path itself to prevent recursion.
   */
  disableFallback?: boolean;
};

export type ExecutionState = {
  executionId: number;
  sessionId: number;
  agentId: string;
  taskId: number;
  status: AgentStatus;
  startedAt: Date;
  output: string;
};

export type OrchestratorEvent = {
  type:
    | 'execution_started'
    | 'execution_output'
    | 'execution_completed'
    | 'execution_failed'
    | 'execution_cancelled';
  executionId: number;
  sessionId: number;
  taskId: number;
  data?: unknown;
  timestamp: Date;
};

export type EventListener = (event: OrchestratorEvent) => void;

/**
 * Tracking info for an active agent.
 */
export type ActiveAgentInfo = {
  agent: BaseAgent;
  executionId: number;
  sessionId: number;
  taskId: number;
  state: ExecutionState;
  lastOutput: string;
  lastSavedAt: Date;
  fileLogger?: ExecutionFileLogger;
};

/**
 * Orchestrator shared context.
 * Provides access to shared state and methods needed by each module.
 */
export type OrchestratorContext = {
  prisma: PrismaClientInstance;
  activeExecutions: Map<number, ExecutionState>;
  activeAgents: Map<number, ActiveAgentInfo>;
  isShuttingDown: boolean;
  serverStartedAt: Date;
  emitEvent: (event: OrchestratorEvent) => void;
  startQuestionTimeout: (executionId: number, taskId: number, questionKey?: QuestionKey) => void;
  cancelQuestionTimeout: (executionId: number) => void;
  getQuestionTimeoutInfo: (executionId: number) => {
    remainingSeconds: number;
    deadline: Date;
    questionKey?: QuestionKey;
  } | null;
  tryAcquireContinuationLock: (
    executionId: number,
    source: 'user_response' | 'auto_timeout',
  ) => boolean;
  releaseContinuationLock: (executionId: number) => void;
  buildAgentConfigFromDb: (
    dbConfig: {
      id: number;
      agentType: string;
      name: string;
      apiKeyEncrypted: string | null;
      endpoint: string | null;
      modelId: string | null;
    },
    options: { workingDirectory?: string; timeout?: number },
  ) => Promise<AgentConfigInput>;
};

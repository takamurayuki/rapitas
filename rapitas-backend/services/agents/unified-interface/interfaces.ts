/**
 * Provider & Agent Interface Definitions
 *
 * Unified interfaces for AI providers, agent execution,
 * session management, and parallel execution control.
 */

import type { AgentCapability, AgentStatus, AgentTask } from '../base-agent';
import type { ProviderId, ModelInfo, ProviderConfig, ValidationResult } from './provider-config';
import type { AgentInstanceConfig, ExecutionOptions } from './agent-config';
import type { OutputHandler, QuestionHandler, ProgressHandler } from './handlers';
import type { ExtendedExecutionResult } from './results';

// ==================== Interfaces ====================

/**
 * AI Agent Provider Interface
 *
 * Each provider (Claude, OpenAI, Gemini, etc.) implements this interface.
 */
export interface IAgentProvider {
  readonly providerId: ProviderId;
  readonly providerName: string;
  readonly supportedModels: ModelInfo[];
  readonly capabilities: AgentCapability;
  isAvailable(): Promise<boolean>;
  validateConfig(config: ProviderConfig): Promise<ValidationResult>;
  createAgent(config: AgentInstanceConfig): IAgent;
}

/**
 * AI Agent Execution Interface
 *
 * Unifies task execution, state management, and output processing.
 */
export interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly providerId: ProviderId;
  getStatus(): AgentStatus;
  getCapabilities(): AgentCapability;
  execute(task: AgentTask, options?: ExecutionOptions): Promise<ExtendedExecutionResult>;
  /** Continue conversation after answering a question */
  continueExecution(response: string, sessionId: string): Promise<ExtendedExecutionResult>;
  stop(): Promise<void>;
  pause(): Promise<boolean>;
  resume(): Promise<boolean>;
  setOutputHandler(handler: OutputHandler): void;
  setQuestionHandler(handler: QuestionHandler): void;
  setProgressHandler(handler: ProgressHandler): void;
}

/**
 * Agent Session Management Interface
 *
 * Unifies conversation continuation and state persistence.
 */
export interface IAgentSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly providerId: ProviderId;
  readonly createdAt: Date;
  lastActivityAt: Date;
  isValid(): boolean;
  invalidate(): void;
  save(): Promise<void>;
  restore(sessionId: string): Promise<boolean>;
  getMetadata(): Record<string, unknown>;
  updateMetadata(metadata: Record<string, unknown>): void;
}

// ==================== Parallel Execution ====================

/**
 * Sub-agent handle
 */
export type SubAgentHandle = {
  agentId: string;
  taskId: number;
  providerId: ProviderId;
  status: AgentStatus;
};

/**
 * Parallel execution options
 */
export type ParallelExecutionOptions = {
  maxConcurrent: number;
  /** Falls back to default if omitted */
  providerId?: ProviderId;
  workingDirectory: string;
  /** In seconds */
  questionTimeoutSeconds: number;
  /** In seconds */
  taskTimeoutSeconds: number;
  retryOnFailure: boolean;
  maxRetries: number;
  logSharing: boolean;
  coordinationEnabled: boolean;
};

/**
 * Sub-agent controller interface
 */
export interface ISubAgentController {
  startAgents(tasks: AgentTask[], options: ParallelExecutionOptions): Promise<SubAgentHandle[]>;
  stopAgent(agentId: string): Promise<void>;
  stopAll(): Promise<void>;
  getAgentState(agentId: string): SubAgentHandle | undefined;
  getAllStates(): Map<string, SubAgentHandle>;
  answerQuestion(agentId: string, response: string): Promise<void>;
}

// ==================== Utility Types ====================

/**
 * Provider registration entry
 */
export type ProviderRegistration = {
  provider: IAgentProvider;
  priority: number;
  isDefault: boolean;
};

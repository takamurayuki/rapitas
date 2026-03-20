/**
 * agent-config.types
 *
 * Per-task configuration records for AI task analysis and agent execution.
 * These are persisted settings that control how agents analyse and execute tasks.
 * Runtime agent state types live in agent.types.ts.
 */

import type { AIAgentConfig } from './agent.types';

// ==================== Task Analysis Settings ====================

export type AnalysisDepth = 'quick' | 'standard' | 'deep';
export type PriorityStrategy = 'aggressive' | 'balanced' | 'conservative';
export type PromptStrategy = 'auto' | 'detailed' | 'concise' | 'custom';

export type TaskAnalysisConfig = {
  id: number;
  taskId: number;

  // Analysis parameters
  analysisDepth: AnalysisDepth;
  maxSubtasks: number;
  priorityStrategy: PriorityStrategy;
  includeEstimates: boolean;
  includeDependencies: boolean;
  includeTips: boolean;

  // Model/provider settings
  agentConfigId?: number | null;
  agentConfig?: Pick<
    AIAgentConfig,
    'id' | 'agentType' | 'name' | 'modelId' | 'isActive'
  > | null;
  modelOverride?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;

  // Prompt strategy
  promptStrategy: PromptStrategy;
  customPromptTemplate?: string | null;
  contextInstructions?: string | null;

  // Automation settings
  autoApproveSubtasks: boolean;
  autoOptimizePrompt: boolean;
  notifyOnComplete: boolean;

  createdAt: string;
  updatedAt: string;
};

// ==================== Agent Execution Settings ====================

export type BranchStrategy = 'auto' | 'manual' | 'none';
export type ApprovalMode = 'always' | 'major_only' | 'never';
export type ReviewScope = 'changes' | 'full' | 'none';

export type AgentExecutionConfig = {
  id: number;
  taskId: number;

  // Agent selection
  agentConfigId?: number | null;
  agentConfig?: Pick<
    AIAgentConfig,
    'id' | 'agentType' | 'name' | 'modelId' | 'isActive'
  > | null;

  // Execution environment settings
  workingDirectory?: string | null;
  timeoutMs: number;
  maxRetries: number;

  // Git settings
  branchStrategy: BranchStrategy;
  branchPrefix: string;
  autoCommit: boolean;
  autoCreatePR: boolean;
  autoMergePR: boolean;
  mergeCommitThreshold: number;

  // Execution control
  requireApproval: ApprovalMode;
  autoExecuteOnAnalysis: boolean;
  parallelExecution: boolean;
  maxConcurrentAgents: number;

  // Prompt settings
  useOptimizedPrompt: boolean;
  additionalInstructions?: string | null;

  // Code review settings
  autoCodeReview: boolean;
  reviewScope: ReviewScope;

  // Notification settings
  notifyOnStart: boolean;
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  notifyOnQuestion: boolean;

  createdAt: string;
  updatedAt: string;
};

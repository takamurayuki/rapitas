/**
 * agent.types
 *
 * Type definitions for AI agents, developer mode, approval requests, and notifications.
 * Per-task analysis/execution config types live in agent-config.types.ts.
 * Does not include task domain types; see task.types.ts.
 */

import type { Priority } from './common.types';
import type { FileDiff, ScreenshotInfo } from './github.types';

// ==================== Execution status ====================

/** Common execution lifecycle status shared across agent and developer-mode contexts. */
export type ExecutionStatus = 'idle' | 'running' | 'completed' | 'failed';

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

/** Common result envelope returned after initiating an agent execution. */
export type ExecutionResult = {
  success: boolean;
  sessionId?: number;
  executionId?: number;
  approvalRequestId?: number;
  message?: string;
  error?: string;
  // Additional info for restored executions
  output?: string;
  waitingForInput?: boolean;
  question?: string;
};

// ==================== Developer Mode ====================

export type DeveloperModeConfig = {
  id: number;
  taskId: number;
  isEnabled: boolean;
  autoApprove: boolean;
  notifyInApp: boolean;
  maxSubtasks: number;
  priority: 'aggressive' | 'balanced' | 'conservative';
  createdAt: string;
  updatedAt: string;
  agentSessions?: AgentSession[];
  approvalRequests?: ApprovalRequest[];
};

export type AgentSessionMetadata = {
  workingDirectory?: string;
  branchName?: string;
  instruction?: string;
  [key: string]: unknown;
};

export type AgentSession = {
  id: number;
  configId: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt?: string | null;
  completedAt?: string | null;
  lastActivityAt: string;
  totalTokensUsed: number;
  errorMessage?: string | null;
  metadata?: AgentSessionMetadata;
  agentActions?: AgentAction[];
  createdAt: string;
  updatedAt: string;
};

export type AgentActionInput = {
  command?: string;
  args?: string[];
  content?: string;
  [key: string]: unknown;
};

export type AgentActionOutput = {
  result?: string;
  files?: string[];
  error?: string;
  [key: string]: unknown;
};

export type AgentAction = {
  id: number;
  sessionId: number;
  actionType: string;
  targetTaskId?: number | null;
  input?: AgentActionInput;
  output?: AgentActionOutput;
  tokensUsed: number;
  durationMs?: number | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
};

export type SubtaskProposal = {
  title: string;
  description: string;
  estimatedHours?: number;
  priority: Priority;
  order: number;
  dependencies?: number[];
};

export type TaskAnalysisResult = {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedTotalHours: number;
  suggestedSubtasks: SubtaskProposal[];
  reasoning: string;
  tips?: string[];
};

/** Minimal task shape used inside ApprovalRequest to avoid a circular import with task.types.ts. */
type ApprovalRequestTask = {
  id: number;
  title: string;
  [key: string]: unknown;
};

export type ApprovalRequest = {
  id: number;
  configId: number;
  config?: DeveloperModeConfig & { task?: ApprovalRequestTask };
  requestType:
    | 'subtask_creation'
    | 'task_execution'
    | 'task_completion'
    | 'code_review';
  title: string;
  description?: string | null;
  proposedChanges: {
    subtasks?: SubtaskProposal[];
    reasoning?: string;
    tips?: string[];
    complexity?: string;
    estimatedTotalHours?: number;
    workingDirectory?: string;
    files?: string[];
    // Additional fields for code review
    structuredDiff?: FileDiff[];
    implementationSummary?: string;
    executionTimeMs?: number;
    // Screenshots
    screenshots?: ScreenshotInfo[];
  };
  estimatedChanges?: {
    diff?: string;
    filesChanged?: number;
    summary?: string;
  } | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  notificationSent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NotificationMetadata = {
  approvalId?: number;
  taskId?: number;
  errorDetails?: string;
  [key: string]: unknown;
};

export type Notification = {
  id: number;
  type:
    | 'approval_request'
    | 'task_completed'
    | 'agent_error'
    | 'daily_summary'
    | 'pr_review_requested'
    | 'agent_execution_started'
    | 'knowledge_extracted'
    | 'knowledge_reminder';
  title: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  readAt?: string | null;
  metadata?: NotificationMetadata;
  createdAt: string;
};

// ==================== AI Agent Config ====================

export type AgentCapability = {
  codeGeneration: boolean;
  codeReview: boolean;
  taskAnalysis: boolean;
  fileOperations: boolean;
  terminalAccess: boolean;
  gitOperations?: boolean;
  webSearch?: boolean;
};

export type AgentType =
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'custom'
  | 'openai'
  | 'azure-openai';

export type AIAgentConfig = {
  id: number;
  agentType: string; // claude-code, anthropic-api, openai, azure-openai, gemini, custom
  name: string;
  endpoint?: string | null;
  modelId?: string | null;
  isDefault: boolean;
  isActive: boolean;
  capabilities: AgentCapability;
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { executions: number };
};

// ==================== Agent Execution ====================

export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentArtifact = {
  type: 'file' | 'code' | 'diff' | 'log';
  name: string;
  content: string;
  path?: string;
};

export type AgentExecution = {
  id: number;
  sessionId: number;
  agentConfigId?: number | null;
  agentConfig?: AIAgentConfig;
  command: string;
  status: AgentExecutionStatus;
  output?: string | null;
  artifacts?: AgentArtifact[] | null;
  startedAt?: string | null;
  completedAt?: string | null;
  tokensUsed: number;
  executionTimeMs?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  gitCommits?: import('./github.types').GitCommit[];
};

// NOTE: TaskAnalysisConfig and AgentExecutionConfig moved to agent-config.types.ts
// to keep this file under 300 lines. Re-exported from index.ts for backward compatibility.
export type {
  AnalysisDepth,
  PriorityStrategy,
  PromptStrategy,
  TaskAnalysisConfig,
  BranchStrategy,
  ApprovalMode,
  ReviewScope,
  AgentExecutionConfig,
} from './agent-config.types';

/**
 * Agent Configuration & Execution Options
 *
 * Defines agent instance configuration and runtime execution options.
 */

// ==================== Agent Configuration ====================

/**
 * Agent instance configuration
 */
export type AgentInstanceConfig = {
  /** Auto-generated if omitted */
  id?: string;
  name: string;
  modelId?: string;
  workingDirectory?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  autoApproveFileOperations?: boolean;
  autoApproveTerminalCommands?: boolean;
  continueConversation?: boolean;
  resumeSessionId?: string;
  custom?: Record<string, unknown>;
};

// ==================== Execution Options ====================

/**
 * Agent execution options
 */
export type ExecutionOptions = {
  workingDirectory?: string;
  modelId?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  autoApproveFileOperations?: boolean;
  autoApproveTerminalCommands?: boolean;
  continueConversation?: boolean;
  resumeSessionId?: string;
  enableStreaming?: boolean;
  /** Question timeout in seconds */
  questionTimeoutSeconds?: number;
  maxTokens?: number;
  /** Temperature parameter (0.0-1.0) */
  temperature?: number;
  systemPromptAddition?: string;
  contextFiles?: string[];
  environmentVariables?: Record<string, string>;
};

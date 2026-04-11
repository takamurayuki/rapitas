/**
 * Agent Abstraction Layer - Agent Identification and Base Types
 */

/**
 * Agent provider identifier.
 */
export type AgentProviderId =
  | 'claude-code'
  | 'openai-codex'
  | 'gemini'
  | 'google-gemini'
  | 'anthropic-api'
  | 'custom';

/**
 * Agent execution state.
 */
export type AgentState =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'waiting_for_input'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * Agent capability flags.
 */
export interface AgentCapabilities {
  // Core capabilities
  codeGeneration: boolean;
  codeReview: boolean;
  codeExecution: boolean;

  // File operations
  fileRead: boolean;
  fileWrite: boolean;
  fileEdit: boolean;

  // External integration
  terminalAccess: boolean;
  gitOperations: boolean;
  webSearch: boolean;
  webFetch: boolean;

  // Task management
  taskAnalysis: boolean;
  taskPlanning: boolean;
  parallelExecution: boolean;

  // Interaction
  questionAsking: boolean;
  conversationMemory: boolean;
  sessionContinuation: boolean;

  // Additional custom capabilities
  [key: string]: boolean | undefined;
}

/**
 * Agent metadata.
 */
export interface AgentMetadata {
  id: string;
  providerId: AgentProviderId;
  name: string;
  version?: string;
  description?: string;
  modelId?: string;
  endpoint?: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

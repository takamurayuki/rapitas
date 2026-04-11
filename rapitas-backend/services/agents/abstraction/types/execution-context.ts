/**
 * Execution context and task definitions.
 */

import type { TaskAnalysisResult, TaskConstraints } from './task-definition';

/**
 * Context information for agent execution.
 */
export interface AgentExecutionContext {
  // Execution identification
  executionId: string;
  sessionId?: string;
  parentExecutionId?: string;

  // Working environment
  workingDirectory: string;
  repositoryUrl?: string;
  branch?: string;

  // Execution options
  timeout?: number;
  maxRetries?: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  // Flags
  dryRun?: boolean;
  verbose?: boolean;
  autoApprove?: boolean;
  dangerouslySkipPermissions?: boolean;

  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Task definition.
 */
export interface AgentTaskDefinition {
  // Basic info
  id: string | number;
  title: string;
  description?: string;

  // Prompts
  prompt?: string;
  optimizedPrompt?: string;

  // Task analysis
  analysis?: TaskAnalysisResult;

  // Dependencies
  dependencies?: Array<string | number>;

  // Constraints
  constraints?: TaskConstraints;
}

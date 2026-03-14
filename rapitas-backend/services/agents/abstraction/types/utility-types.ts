/**
 * Utility type definitions.
 */

/**
 * Context for continuing a previous execution.
 */
export interface ContinuationContext {
  sessionId: string;
  previousExecutionId: string;
  userResponse?: string;
  additionalContext?: string;
}

/**
 * Batch execution options.
 */
export interface BatchExecutionOptions {
  maxConcurrency: number; 
  continueOnError: boolean; 
  timeout?: number; 
  ordering?: 'sequential' | 'parallel' | 'dependency-based';
}

/**
 * Agent health check result.
 */
export interface AgentHealthStatus {
  healthy: boolean;
  available: boolean;
  latency?: number; 
  errors?: string[];
  lastCheck: Date;
  details?: Record<string, unknown>;
}

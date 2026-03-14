/**
 * Utility Functions
 *
 * Provides defaults and merging for execution options.
 */

import type { ExecutionOptions } from './agent-config';

/**
 * Returns default execution options.
 */
export function getDefaultExecutionOptions(): ExecutionOptions {
  return {
    timeout: 900000, // 15 minutes
    enableStreaming: true,
    questionTimeoutSeconds: 300, // 5 minutes
    autoApproveFileOperations: true,
    autoApproveTerminalCommands: true,
  };
}

/**
 * Merges execution options, with override taking precedence.
 */
export function mergeExecutionOptions(
  base: ExecutionOptions,
  override?: Partial<ExecutionOptions>,
): ExecutionOptions {
  if (!override) {
    return { ...base };
  }
  return { ...base, ...override };
}

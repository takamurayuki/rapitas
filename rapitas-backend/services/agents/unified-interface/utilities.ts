/**
 * ユーティリティ関数
 *
 * 実行オプションのデフォルト値取得・マージ機能を提供
 */

import type { ExecutionOptions } from './agent-config';

/**
 * デフォルトの実行オプションを取得
 */
export function getDefaultExecutionOptions(): ExecutionOptions {
  return {
    timeout: 900000, // 15分
    enableStreaming: true,
    questionTimeoutSeconds: 300, // 5分
    autoApproveFileOperations: true,
    autoApproveTerminalCommands: true,
  };
}

/**
 * 実行オプションをマージ
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

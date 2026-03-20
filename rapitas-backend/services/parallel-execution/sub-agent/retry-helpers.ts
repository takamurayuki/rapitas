/**
 * RetryHelpers
 *
 * Failure classification and retry-context construction for the sub-agent
 * self-healing loop. Determines whether a failed execution is worth retrying
 * and builds a prompt suffix that helps the agent understand what to fix.
 */

/**
 * Classify a failure from agent output to decide if retry is worthwhile.
 *
 * @param output - Agent execution output / エージェント実行出力
 * @param errorMessage - Error message if any / エラーメッセージ
 * @returns Failure type or 'unknown' if not retryable / 失敗タイプ
 */
export function classifyFailure(
  output: string,
  errorMessage?: string,
): 'test_failed' | 'lint_error' | 'type_error' | 'timeout' | 'unknown' {
  const text = `${output}\n${errorMessage || ''}`;

  if (/\bFAIL\b|test.*fail|failed.*test|× |✕ |FAILED/i.test(text)) {
    return 'test_failed';
  }
  if (/eslint|lint.*error|prettier.*error|lint-staged/i.test(text)) {
    return 'lint_error';
  }
  if (/error TS\d+|type.*error|TypeError|cannot find name/i.test(text)) {
    return 'type_error';
  }
  if (/timed?\s*out|timeout exceeded/i.test(text)) {
    return 'timeout';
  }

  return 'unknown';
}

/**
 * Build context string for retry prompt so the agent knows what to fix.
 *
 * @param failureType - Classified failure type / 分類された失敗タイプ
 * @param output - Previous execution output / 前回の実行出力
 * @param errorMessage - Error message / エラーメッセージ
 * @returns Retry context for prompt injection / プロンプト注入用リトライコンテキスト
 */
export function buildRetryContext(
  failureType: string,
  output: string,
  errorMessage?: string,
): string {
  const errorLines = (output || '')
    .split('\n')
    .filter((line) => /error|fail|FAIL|×|✕|warn/i.test(line))
    .slice(-30)
    .join('\n');

  const typeLabel: Record<string, string> = {
    test_failed: 'テスト失敗',
    lint_error: 'Lintエラー',
    type_error: '型エラー',
    timeout: 'タイムアウト',
  };

  return `**エラー種別**: ${typeLabel[failureType] || failureType}\n${errorMessage ? `**メッセージ**: ${errorMessage}\n` : ''}\n**関連するエラー出力**:\n\`\`\`\n${errorLines || '(出力なし)'}\n\`\`\``;
}

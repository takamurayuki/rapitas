/**
 * useAgentExecution.helpers
 *
 * Pure derivation functions used by useAgentExecution (question-state
 * computation, question-option parsing, status-flag computation).
 * Extracted from the hook file to keep it under the size limit; behavior is
 * unchanged.
 */
import { parseQuestionOptions, type ParsedQuestion } from './agent-execution-utils';
import type { QuestionType } from './agent-execution-types';

/**
 * Compute question state from polling data.
 */
export function computeQuestionState(
  isTerminalStatus: boolean,
  pollingWaitingForInput: boolean,
  pollingQuestion: string | undefined,
  pollingQuestionType: string | undefined,
): { hasQuestion: boolean; question: string; questionType: QuestionType } {
  if (!isTerminalStatus && pollingWaitingForInput && pollingQuestion) {
    return {
      hasQuestion: true,
      question: pollingQuestion,
      questionType: pollingQuestionType === 'tool_call' ? 'tool_call' : 'none',
    };
  }
  return { hasQuestion: false, question: '', questionType: 'none' };
}

/**
 * Parse question options from structured or text-based format.
 *
 * @param question - Raw question text from the agent. / エージェントからの生の質問文
 * @param pollingQuestionDetails - Structured options from an AskUserQuestion tool call, if any.
 * @param t - Translator (scoped to `devMode.parseQuestionOptions`) used to localize
 *   fallback yes/no-style option labels when text-based parsing is used. / フォールバック選択肢の翻訳に使う関数
 */
export function parseQuestionWithDetails(
  question: string | undefined,
  // NOTE: 上流の questionDetails は description / headers / multiSelect 等を持つが
  // ここで使うのは options[].label のみなので、ワイドな入力を許容する。
  pollingQuestionDetails:
    | {
        options?: { label: string; description?: string }[];
        headers?: string[];
        multiSelect?: boolean;
      }
    | null
    | undefined,
  t: (key: string) => string,
): ParsedQuestion | null {
  if (!question) return null;

  // Use structured questionDetails when available (from AskUserQuestion tool calls)
  if (pollingQuestionDetails?.options && pollingQuestionDetails.options.length > 0) {
    return {
      text: question,
      options: pollingQuestionDetails.options.map((opt) => opt.label),
    };
  }

  // Fallback to text-based parsing for legacy support
  return parseQuestionOptions(question, t);
}

/** Status flags for execution state. */
export type StatusFlags = {
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean;
  isRunning: boolean;
};

/**
 * Compute derived status flags from execution state.
 */
export function computeStatusFlags(params: {
  finalStatus: string;
  isPollingRunning: boolean;
  isSseRunning: boolean;
  isWaitingForInput: boolean;
  isRestoredTerminal: boolean;
  executionResult: { success?: boolean } | null;
  isExecuting: boolean;
  pollingStatus: string;
  sseStatus: string;
  error: string | null;
  pollingError: string | null;
  sseError: string | null;
}): StatusFlags {
  const {
    finalStatus,
    isPollingRunning,
    isSseRunning,
    isWaitingForInput,
    isRestoredTerminal,
    executionResult,
    isExecuting,
    pollingStatus,
    sseStatus,
    error,
    pollingError,
    sseError,
  } = params;

  // finalStatus prefers sseStatus over pollingStatus (see useAgentExecution.ts),
  // but useExecutionStreamSSE's execution_completed handler sets status:
  // 'completed' unconditionally on EVERY workflow phase boundary (research/
  // plan/implement each end their own AgentExecution row) — it has no way to
  // know a phase is auto-advancing, unlike execution-poll-completion.ts's
  // handleCompleted, which keeps pollingStatus at 'running' across those
  // boundaries specifically so the UI doesn't flash "completed" between
  // phases. Trusting finalStatus alone here re-introduced that exact flash
  // via the SSE path: reported as the Reset/PR-open buttons appearing right
  // after research/plan/implement finished, self-correcting on reload once
  // the next phase's genuinely-fresh state took over. Requiring
  // pollingStatus !== 'running' means the moment EITHER source knows the
  // task isn't really done yet, that wins over the other's stale signal.
  const isCompleted =
    (finalStatus === 'completed' &&
      pollingStatus !== 'running' &&
      !isPollingRunning &&
      !isSseRunning &&
      !isWaitingForInput) ||
    (isRestoredTerminal && executionResult?.success === true);

  const isCancelled = finalStatus === 'cancelled';

  const isFailed =
    !!(finalStatus === 'failed' || error || pollingError || sseError) ||
    (isRestoredTerminal && executionResult?.success === false);

  const isRunning =
    !isRestoredTerminal &&
    (isExecuting ||
      isPollingRunning ||
      isSseRunning ||
      pollingStatus === 'running' ||
      sseStatus === 'running' ||
      isWaitingForInput);

  return { isCompleted, isCancelled, isFailed, isRunning };
}

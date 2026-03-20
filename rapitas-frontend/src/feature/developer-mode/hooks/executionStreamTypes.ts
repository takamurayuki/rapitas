/**
 * executionStreamTypes
 *
 * Shared type definitions and utilities for execution stream hooks.
 * Does not contain any React state logic.
 */

'use client';

export type ExecutionEventData = {
  output?: string;
  result?: unknown;
  error?: { errorMessage?: string };
  [key: string]: unknown;
};

export type ExecutionEvent = {
  type: 'started' | 'output' | 'completed' | 'failed' | 'cancelled';
  data: ExecutionEventData;
  timestamp: string;
};

/**
 * Type representing the kind of question
 * - 'tool_call': Question via Claude Code AskUserQuestion tool call (explicit AI agent status)
 * - 'none': No question
 *
 * NOTE: 'pattern_match' is deprecated. Only explicit AI agent status is trusted.
 */
export type QuestionType = 'tool_call' | 'none';

/**
 * Question timeout info
 */
export type QuestionTimeoutInfo = {
  /** Remaining seconds */
  remainingSeconds: number;
  /** Timeout deadline */
  deadline: string;
  /** Total seconds */
  totalSeconds: number;
};

export type ExecutionStreamState = {
  isConnected: boolean;
  isRunning: boolean;
  logs: string[];
  status:
    | 'idle'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'waiting_for_input';
  error: string | null;
  result: unknown | null;
  waitingForInput?: boolean;
  question?: string;
  /** Question detection method (tool_call: AskUserQuestion tool call, none: no question) */
  questionType?: QuestionType;
  /** Question timeout info (only when waiting for input) */
  questionTimeout?: QuestionTimeoutInfo;
  /** Structured question details from the agent (options, headers, multiSelect). */
  questionDetails?: { options?: Array<{ label: string; description?: string }>; headers?: string[]; multiSelect?: boolean } | null;
  /** Session mode (e.g. workflow-researcher) */
  sessionMode?: string | null;
  /** Tokens used in this execution */
  tokensUsed?: number;
  /** Total token usage for the session */
  totalSessionTokens?: number;
};

// Max log entries to prevent memory leaks
export const MAX_LOG_ENTRIES = 500;

/**
 * Trim log array to prevent exceeding the max entry limit
 *
 * @param logs - Current log array / 現在のログ配列
 * @returns Trimmed log array / トリム済みのログ配列
 */
export function trimLogs(logs: string[]): string[] {
  if (logs.length <= MAX_LOG_ENTRIES) return logs;
  return logs.slice(-MAX_LOG_ENTRIES);
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ExecutionStream');

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
  /** Structured question details from the agent (options, headers, multiSelect, etc.) */
  questionDetails?: { options?: Array<{ label: string; description?: string }>; headers?: string[]; multiSelect?: boolean } | null;
  /** Session mode (e.g. workflow-researcher) */
  sessionMode?: string | null;
  /** Tokens used in this execution */
  tokensUsed?: number;
  /** Total token usage for the session */
  totalSessionTokens?: number;
};

// NOTE: SSE is currently disabled (polling is the primary mechanism)
const SSE_ENABLED = false;

// Max log entries to prevent memory leaks
const MAX_LOG_ENTRIES = 500;

/** Trim log array to prevent exceeding the max entry limit */
function trimLogs(logs: string[]): string[] {
  if (logs.length <= MAX_LOG_ENTRIES) return logs;
  return logs.slice(-MAX_LOG_ENTRIES);
}

export function useExecutionStream(sessionId: number | null) {
  const [state, setState] = useState<ExecutionStreamState>({
    isConnected: false,
    isRunning: false,
    logs: [],
    status: 'idle',
    error: null,
    result: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const logsRef = useRef<string[]>([]);

  const connect = useCallback(() => {
    if (!SSE_ENABLED) {
      logger.debug('SSE disabled, using polling instead');
      return;
    }

    if (!sessionId) {
      logger.debug('No sessionId, skipping connection');
      return;
    }
    if (eventSourceRef.current) {
      logger.debug('Already connected, skipping');
      return;
    }

    const channel = `session:${sessionId}`;
    const url = `${API_BASE_URL}/events/subscribe/${encodeURIComponent(channel)}`;

    logger.debug('Connecting to:', url);

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        logger.debug('Connection opened');
        setState((prev) => ({ ...prev, isConnected: true, error: null }));
      };

      eventSource.onerror = () => {
        // NOTE: EventSource errors may indicate reconnection attempts,
        // so check readyState to determine if it's a real error
        if (eventSource.readyState === EventSource.CLOSED) {
          logger.debug('Connection closed, will use polling fallback');
          eventSourceRef.current = null;
          setState((prev) => ({
            ...prev,
            isConnected: false,
            // No error message displayed (polling serves as fallback)
          }));
        } else if (eventSource.readyState === EventSource.CONNECTING) {
          logger.debug('Reconnecting...');
        }
      };

      // Connection confirmation event (sent by server)
      eventSource.addEventListener('connected', (event) => {
        logger.debug('Connected event received:', event.data);
        setState((prev) => ({ ...prev, isConnected: true, error: null }));
      });

      // Execution started event
      eventSource.addEventListener('execution_started', (event) => {
        logger.info('Execution started:', event.data);
        logsRef.current = ['[開始] エージェントの実行を開始しました...\n'];
        setState((prev) => ({
          ...prev,
          isRunning: true,
          status: 'running',
          logs: logsRef.current,
        }));
      });

      // Output event
      eventSource.addEventListener('execution_output', (event) => {
        try {
          const data = JSON.parse(event.data);
          const output = data.output || '';
          logsRef.current = trimLogs([...logsRef.current, output]);
          setState((prev) => ({
            ...prev,
            logs: logsRef.current,
          }));
        } catch (e) {
          logger.error('Failed to parse output:', e);
        }
      });

      // Completion event
      eventSource.addEventListener('execution_completed', (event) => {
        logger.info('Execution completed:', event.data);
        try {
          const data = JSON.parse(event.data);
          logsRef.current = trimLogs([
            ...logsRef.current,
            '\n[完了] エージェントの実行が完了しました。\n',
          ]);
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'completed',
            logs: logsRef.current,
            result: data.result,
          }));
        } catch (e) {
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'completed',
            logs: [...logsRef.current, '\n[完了] 実行完了\n'],
          }));
        }
      });

      // Failure event
      eventSource.addEventListener('execution_failed', (event) => {
        logger.info('Execution failed:', event.data);
        try {
          const data = JSON.parse(event.data);
          logsRef.current = trimLogs([
            ...logsRef.current,
            `\n[Error] ${data.error?.errorMessage || '実行に失敗しました'}\n`,
          ]);
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'failed',
            logs: logsRef.current,
            error: data.error?.errorMessage || '実行に失敗しました',
          }));
        } catch (e) {
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'failed',
            logs: [...logsRef.current, '\n[Error] Execution failed\n'],
          }));
        }
      });

      // Cancellation event
      eventSource.addEventListener('execution_cancelled', (event) => {
        logger.info('Execution cancelled');
        logsRef.current = trimLogs([
          ...logsRef.current,
          '\n[キャンセル] 実行がキャンセルされました。\n',
        ]);
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: 'cancelled',
          logs: logsRef.current,
        }));
      });

      return () => {
        eventSource.close();
        eventSourceRef.current = null;
      };
    } catch (error) {
      logger.error('Failed to create EventSource:', error);
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: 'SSE接続の作成に失敗しました',
      }));
    }
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setState((prev) => ({ ...prev, isConnected: false }));
    }
  }, []);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setState((prev) => ({
      ...prev,
      logs: [],
      status: 'idle',
      error: null,
      result: null,
    }));
  }, []);

  // Reconnect when sessionId changes
  useEffect(() => {
    if (sessionId) {
      const timer = setTimeout(() => connect(), 0);
      return () => {
        clearTimeout(timer);
        disconnect();
      };
    }
    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    clearLogs,
  };
}

/**
 * Polling-based execution state hook (fallback when SSE is unavailable)
 */
export function useExecutionPolling(taskId: number | null) {
  const [state, setState] = useState<ExecutionStreamState>({
    isConnected: false,
    isRunning: false,
    logs: [],
    status: 'idle',
    error: null,
    result: null,
    waitingForInput: false,
    question: undefined,
    questionType: 'none',
    questionTimeout: undefined,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastOutputLengthRef = useRef(0);
  // NOTE: Grace period to absorb race where terminal status persists briefly after continuation
  const terminalStatusGraceUntilRef = useRef<number>(0);
  // Track whether final log has been added (prevent duplicates)
  const hasAddedFinalLogRef = useRef(false);
  // Track last processed status (prevent duplicate processing)
  const lastProcessedStatusRef = useRef<string | null>(null);
  // Track last processed question (prevent duplicate processing)
  const lastProcessedQuestionRef = useRef<string | null>(null);
  // NOTE: Grace period after answer submission (prevents race with DB status update)
  const responseGraceUntilRef = useRef<number>(0);
  // Cleared question text on answer submission (prevents re-detection of same question)
  const clearedQuestionRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  /**
   * Start polling
   * @param options.initialOutput Initial output for restore (when specified, log is not reset; diffs are fetched from this position)
   * @param options.preserveLogs When true, preserve existing logs
   */
  const startPolling = useCallback(
    async (options?: {
      initialOutput?: string;
      preserveLogs?: boolean;
      terminalGraceMs?: number;
    }) => {
      logger.debug(
        'startPolling called, taskId:',
        taskId,
        'intervalRef:',
        intervalRef.current,
        'options:',
        options,
      );
      if (!taskId || intervalRef.current) {
        logger.debug(
          'Skipping - taskId:',
          taskId,
          'intervalRef exists:',
          !!intervalRef.current,
        );
        return;
      }

      logger.debug('Starting polling for task:', taskId);

      // NOTE: On continuation, the backend may return the old execution's completed status
      // until a new execution is created, so a short grace period is needed
      const terminalGraceMs =
        typeof options?.terminalGraceMs === 'number'
          ? options.terminalGraceMs
          : options?.preserveLogs
            ? 2000
            : 0;
      terminalStatusGraceUntilRef.current =
        terminalGraceMs > 0 ? Date.now() + terminalGraceMs : 0;

      // Reset final log flag and status tracking
      // NOTE: For preserveLogs (continuation), skip final log since the previous run already added one
      hasAddedFinalLogRef.current = !!options?.preserveLogs;
      lastProcessedStatusRef.current = null;
      lastProcessedQuestionRef.current = null;
      responseGraceUntilRef.current = 0;
      clearedQuestionRef.current = null;

      // Start from initial output length when restoring
      if (options?.initialOutput) {
        lastOutputLengthRef.current = options.initialOutput.length;
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
          logs: options.preserveLogs
            ? prev.logs
            : [options.initialOutput || ''],
        }));
      } else if (options?.preserveLogs) {
        // When preserving logs
        // NOTE: Do not reset lastOutputLengthRef.current. By keeping the previously tracked
        // output position, only new output is appended during continuation.
        // The backend stores state.output (previous + new output) in DB on continuation,
        // so reading the diff from the previous position yields only new output.
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
        }));
      } else {
        // Reset for new execution
        lastOutputLengthRef.current = 0;
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
          logs: [],
        }));
      }

      const poll = async () => {
        // Skip polling in cancelled state (prevents overwriting cancelled status)
        if (lastProcessedStatusRef.current === 'cancelled') {
          logger.debug('Skipping poll - already cancelled');
          return;
        }

        try {
          // Fetch with 10-second timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const res = await fetch(
            `${API_BASE_URL}/tasks/${taskId}/execution-status`,
            {
              signal: controller.signal,
            },
          );
          clearTimeout(timeoutId);

          // Ignore result if cancelled during fetch
          if (lastProcessedStatusRef.current === 'cancelled') {
            logger.debug('Ignoring result - cancelled during fetch');
            return;
          }

          if (!res.ok) {
            logger.debug('Response not ok:', res.status);
            return;
          }

          const data = await res.json();

          // Skip if no execution data
          if (!data.executionStatus || data.status === 'none') {
            logger.debug('No execution data yet');
            return;
          }

          // Always update token usage
          const polledTokensUsed = data.tokensUsed as number | undefined;
          const polledTotalSessionTokens = data.totalSessionTokens as
            | number
            | undefined;
          if (polledTokensUsed || polledTotalSessionTokens) {
            setState((prev) => ({
              ...prev,
              tokensUsed: polledTokensUsed ?? prev.tokensUsed,
              totalSessionTokens:
                polledTotalSessionTokens ?? prev.totalSessionTokens,
            }));
          }

          // Update output
          if (data.output) {
            const currentLength = lastOutputLengthRef.current;
            const newOutput = data.output.slice(currentLength);
            if (newOutput) {
              logger.debug('New output received:', newOutput.length, 'chars');
              lastOutputLengthRef.current = data.output.length;
              setState((prev) => {
                // Skip if consecutive duplicate (same as last log entry)
                const lastLog = prev.logs[prev.logs.length - 1];
                if (lastLog && lastLog === newOutput) {
                  logger.debug('Skipping duplicate consecutive log entry');
                  return prev;
                }
                return {
                  ...prev,
                  logs: trimLogs([...prev.logs, newOutput]),
                };
              });
            }
          }

          // Process based on status
          // Prevent duplicate processing of same status
          const currentStatus = data.executionStatus;
          const isStatusChanged =
            lastProcessedStatusRef.current !== currentStatus;

          // NOTE: Absorb race after continuation: temporarily ignore terminal status
          if (
            terminalStatusGraceUntilRef.current > 0 &&
            Date.now() < terminalStatusGraceUntilRef.current &&
            (data.executionStatus === 'completed' ||
              data.executionStatus === 'failed' ||
              data.executionStatus === 'cancelled' ||
              data.executionStatus === 'interrupted')
          ) {
            setState((prev) => ({
              ...prev,
              isConnected: true,
              isRunning: true,
              status: 'running',
            }));
            return;
          }

          if (data.executionStatus === 'completed') {
            // Skip if already processed same status
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }
            logger.info('Execution completed');
            lastProcessedStatusRef.current = currentStatus;
            // Only add final log if not already added (prevent duplicates)
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            // Show phase-specific completion message for workflow phases
            const sessionMode = data.sessionMode as string | null;
            let completionMessage = '\n[完了] 実行が完了しました。\n';
            if (sessionMode?.startsWith('workflow-')) {
              const WORKFLOW_PHASE_LABELS: Record<string, string> = {
                'workflow-researcher':
                  '[調査完了] リサーチフェーズが完了しました。次は計画フェーズを実行してください。',
                'workflow-planner':
                  '[計画作成完了] 計画フェーズが完了しました。計画内容を確認し、承認してください。',
                'workflow-reviewer':
                  '[レビュー完了] レビューフェーズが完了しました。計画内容を確認し、承認してください。',
                'workflow-implementer':
                  '[実装完了] 実装フェーズが完了しました。検証フェーズを自動実行中...',
                'workflow-verifier':
                  '[検証完了] 検証フェーズが完了しました。検証結果を確認し、問題なければタスクを完了にしてください。',
              };
              completionMessage =
                '\n' +
                (WORKFLOW_PHASE_LABELS[sessionMode] ||
                  `[フェーズ完了] ${sessionMode}が完了しました。`) +
                '\n';
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'completed',
              waitingForInput: false,
              question: undefined,
              sessionMode: sessionMode || prev.sessionMode,
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([...prev.logs, completionMessage])
                  : shouldAddLog
                    ? [completionMessage]
                    : prev.logs,
            }));
            stopPolling();
          } else if (data.executionStatus === 'failed') {
            // Skip if already processed same status
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }

            // NOTE: During grace period after answer submission, a transient failure may
            // occur during session resume fallback, so don't treat as failed immediately
            const isInFailedGracePeriod =
              Date.now() < responseGraceUntilRef.current;
            if (
              isInFailedGracePeriod &&
              lastProcessedStatusRef.current === 'responding'
            ) {
              logger.debug(
                'Ignoring failed status during grace period (session fallback may be in progress)',
              );
              return;
            }

            logger.info('Execution failed:', data.errorMessage);
            lastProcessedStatusRef.current = currentStatus;
            // Only add final log if not already added (prevent duplicates)
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'failed',
              waitingForInput: false,
              error: data.errorMessage,
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([
                      ...prev.logs,
                      `\n[Error] ${data.errorMessage || 'Execution failed'}\n`,
                    ])
                  : shouldAddLog
                    ? [`[Error] ${data.errorMessage || 'Execution failed'}\n`]
                    : prev.logs,
            }));
            stopPolling();
          } else if (data.executionStatus === 'cancelled') {
            // Skip if already processed same status
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }
            logger.info('Execution cancelled');
            lastProcessedStatusRef.current = currentStatus;
            // Only add final log if not already added (prevent duplicates)
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'cancelled',
              waitingForInput: false,
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([
                      ...prev.logs,
                      '\n[キャンセル] 実行が停止されました。\n',
                    ])
                  : shouldAddLog
                    ? ['[キャンセル] 実行が停止されました。\n']
                    : prev.logs,
            }));
            stopPolling();
          } else if (data.executionStatus === 'interrupted') {
            // Skip if already processed same status
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }

            // Skip during grace period after answer submission
            const isInInterruptedGracePeriod =
              Date.now() < responseGraceUntilRef.current;
            if (
              isInInterruptedGracePeriod &&
              lastProcessedStatusRef.current === 'responding'
            ) {
              logger.debug('Ignoring interrupted status during grace period');
              return;
            }

            logger.info('Execution interrupted');
            lastProcessedStatusRef.current = currentStatus;
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'failed',
              waitingForInput: false,
              error: data.errorMessage || '実行が中断されました',
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([
                      ...prev.logs,
                      '\n[中断] 実行が中断されました。\n',
                    ])
                  : shouldAddLog
                    ? ['[中断] 実行が中断されました。\n']
                    : prev.logs,
            }));
            stopPolling();
          } else if (
            data.executionStatus === 'waiting_for_input' ||
            data.waitingForInput
          ) {
            // Don't overwrite cancelled state
            if (lastProcessedStatusRef.current === 'cancelled') {
              return;
            }

            // NOTE: Ignore waiting_for_input during grace period after answer submission
            // (DB status may not have updated to running yet, or
            //   race condition during session resume fallback)
            const currentQuestion = data.question || '';
            const isInGracePeriod = Date.now() < responseGraceUntilRef.current;
            if (
              isInGracePeriod &&
              (lastProcessedStatusRef.current === 'responding' ||
                lastProcessedStatusRef.current === 'running')
            ) {
              // During grace period, ignore same/empty questions
              if (
                !currentQuestion ||
                clearedQuestionRef.current === currentQuestion
              ) {
                logger.debug(
                  'Ignoring stale waiting_for_input during grace period',
                );
                return;
              }
              // During grace period, allow new (different) questions through
              logger.debug(
                'New question detected during grace period, allowing through',
              );
            }

            // If same question already processed, only update timeout info
            const isNewQuestion =
              lastProcessedStatusRef.current !== 'waiting_for_input' ||
              lastProcessedQuestionRef.current !== currentQuestion;

            // Get timeout info
            const timeoutInfo: QuestionTimeoutInfo | undefined =
              data.questionTimeout
                ? {
                    remainingSeconds: data.questionTimeout.remainingSeconds,
                    deadline: data.questionTimeout.deadline,
                    totalSeconds: data.questionTimeout.totalSeconds,
                  }
                : undefined;

            if (isNewQuestion) {
              logger.debug(
                'Waiting for input:',
                currentQuestion,
                'questionType:',
                data.questionType,
                'timeout:',
                timeoutInfo,
              );
              lastProcessedStatusRef.current = 'waiting_for_input';
              lastProcessedQuestionRef.current = currentQuestion;
              // New question detected; reset grace period and cleared question
              responseGraceUntilRef.current = 0;
              clearedQuestionRef.current = null;
            }

            setState((prev) => ({
              ...prev,
              isRunning: true,
              status: 'waiting_for_input',
              waitingForInput: true,
              question: currentQuestion,
              // NOTE: questionType uses API value only (pattern_match fallback removed)
              // Only trust explicit AI agent status (tool_call)
              questionType:
                data.questionType === 'tool_call' ? 'tool_call' : 'none',
              questionTimeout: timeoutInfo,
              questionDetails: data.questionDetails || null,
            }));
          } else if (data.executionStatus === 'running') {
            // Don't overwrite cancelled state
            if (lastProcessedStatusRef.current === 'cancelled') {
              return;
            }
            // Confirm DB has updated to running
            if (lastProcessedStatusRef.current === 'responding') {
              lastProcessedStatusRef.current = 'running';
              // NOTE: Don't clear grace period here yet
              // During session resume fallback, running->waiting_for_input(stale)->running
              // transitions can occur, so let the grace period expire naturally
            }
            setState((prev) => ({
              ...prev,
              isRunning: true,
              status: 'running',
            }));
          }
        } catch (error) {
          // AbortError from timeout - silently skip
          if (error instanceof Error && error.name === 'AbortError') {
            logger.debug('Request timed out, will retry');
            return;
          }
          // TypeError: Failed to fetch = network error - backend may be unresponsive
          if (
            error instanceof TypeError &&
            error.message.includes('Failed to fetch')
          ) {
            logger.warn('Network error - backend may be unresponsive');
            return;
          }
          logger.error('Polling error:', error);
        }
      };

      // Initial poll
      await poll();

      // Poll every 300ms for near-realtime responsiveness
      intervalRef.current = setInterval(poll, 300);
    },
    [taskId, stopPolling],
  );

  /**
   * Set execution to cancelled state (for immediate UI update on stop button press)
   */
  const setCancelled = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (
      lastProcessedStatusRef.current === 'cancelled' &&
      hasAddedFinalLogRef.current
    ) {
      return;
    }
    lastProcessedStatusRef.current = 'cancelled';
    // Only add final log if not already added
    const shouldAddLog = !hasAddedFinalLogRef.current;
    if (shouldAddLog) {
      hasAddedFinalLogRef.current = true;
    }
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isRunning: false,
      status: 'cancelled',
      waitingForInput: false,
      question: undefined,
      logs:
        shouldAddLog && prev.logs.length > 0
          ? trimLogs([...prev.logs, '\n[キャンセル] 実行が停止されました。\n'])
          : shouldAddLog
            ? ['[キャンセル] 実行が停止されました。\n']
            : prev.logs,
    }));
  }, []);

  const clearLogs = useCallback(() => {
    lastOutputLengthRef.current = 0;
    hasAddedFinalLogRef.current = false;
    lastProcessedStatusRef.current = null;
    lastProcessedQuestionRef.current = null;
    responseGraceUntilRef.current = 0;
    clearedQuestionRef.current = null;
    setState({
      isConnected: false,
      isRunning: false,
      logs: [],
      status: 'idle',
      error: null,
      result: null,
      waitingForInput: false,
      question: undefined,
      questionType: 'none',
      questionTimeout: undefined,
    });
  }, []);

  /**
   * Clear question state after an answer has been submitted
   * Returns status to running while preserving logs
   * Sets a grace period to prevent race conditions before DB status update
   */
  const clearQuestion = useCallback(() => {
    // Record cleared question (prevent re-detection of same question)
    clearedQuestionRef.current = lastProcessedQuestionRef.current;
    // Reset question status tracking to accept new questions
    lastProcessedStatusRef.current = 'responding';
    lastProcessedQuestionRef.current = null;
    // NOTE: 8-second grace period suppresses waiting_for_input re-detection
    // This allows enough time for the 3-stage session resume fallback
    // (--resume -> --continue -> new session)
    responseGraceUntilRef.current = Date.now() + 8000;
    setState((prev) => ({
      ...prev,
      status: 'running',
      waitingForInput: false,
      question: undefined,
      questionType: 'none',
      questionTimeout: undefined,
    }));
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    ...state,
    startPolling,
    stopPolling,
    clearLogs,
    setCancelled,
    clearQuestion,
  };
}

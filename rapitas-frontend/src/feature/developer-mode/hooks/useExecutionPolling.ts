'use client';
// useExecutionPolling

import { useState, useCallback, useRef, useEffect } from 'react';
import { createLogger } from '@/lib/logger';
import { type ExecutionStreamState, trimLogs } from './execution-stream-types';
import { type PollRefs, executePoll } from './execution-poll-handlers';

const logger = createLogger('ExecutionStream');

/**
 * Polling-based execution state hook (primary mechanism when SSE is unavailable)
 *
 * @param taskId - Task ID to poll execution status for / 実行状態をポーリングするタスクID
 * @returns Execution stream state and polling control methods
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

  const refs: PollRefs = {
    lastProcessedStatusRef,
    hasAddedFinalLogRef,
    lastProcessedQuestionRef,
    responseGraceUntilRef,
    clearedQuestionRef,
    terminalStatusGraceUntilRef,
  };

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  /**
   * Start polling for execution status
   *
   * @param options.initialOutput - Initial output for restore / リストア時の初期出力
   * @param options.preserveLogs - When true, preserve existing logs / trueの場合ログを保持
   * @param options.terminalGraceMs - Grace period before accepting terminal status / ターミナル状態受け入れグレース期間（ms）
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
        // NOTE: Do not reset lastOutputLengthRef.current — only new output is appended.
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
        }));
      } else {
        lastOutputLengthRef.current = 0;
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
          logs: [],
        }));
      }

      const poll = () =>
        executePoll(taskId, refs, lastOutputLengthRef, setState, stopPolling);

      // Initial poll
      await poll();

      // Poll every 300ms for near-realtime responsiveness
      intervalRef.current = setInterval(poll, 300);
    },
    // NOTE: refs object is stable (same ref objects across renders); no need to include in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
   * Clear question state after an answer has been submitted.
   * Returns status to running while preserving logs.
   * Sets a grace period to prevent race conditions before DB status update.
   */
  const clearQuestion = useCallback(() => {
    // Record cleared question (prevent re-detection of same question)
    clearedQuestionRef.current = lastProcessedQuestionRef.current;
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

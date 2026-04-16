'use client';
// useExecutionStreamSSE

import { useState, useCallback, useRef, useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { type ExecutionStreamState, trimLogs } from './execution-stream-types';

const logger = createLogger('ExecutionStream');

// NOTE: SSE is currently disabled (polling is the primary mechanism)
const SSE_ENABLED = false;

/**
 * SSE-based execution stream hook
 *
 * @param sessionId - Agent session ID to subscribe to / 購読するエージェントセッションID
 * @returns Execution stream state and control methods
 */
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

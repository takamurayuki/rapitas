'use client';
// useExecutionStreamSSE

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { type ExecutionStreamState, trimLogs } from './execution-stream-types';

const logger = createLogger('ExecutionStream');

// NOTE: SSE is disabled. Verified live-tail assessment (operability review,
// 2026-07): useExecutionPolling's ~1s cursor poll (see useExecutionPolling.ts)
// is the ONLY mechanism actually driving the log tail today — this hook's
// `connect()` no-ops while SSE_ENABLED is false, so `isConnected` never
// becomes true, and useAgentExecution's `logs` selector
// (`isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs`) always
// falls through to pollingLogs. Confirmed working, so this stays off rather
// than being "fixed" — the reason it was turned off in the first place is
// still true: this hook opens ONE EventSource PER SESSION
// (`new EventSource(.../events/subscribe/session:{sessionId})`), and
// Chromium/WebView2 caps concurrent connections at ~6 per origin (see
// src/lib/sse/shared-event-source.ts's header comment for the incident this
// caused during auto-run). A safe re-enable would NOT reopen a per-session
// EventSource here — it would subscribe through the app-wide
// `sharedEventSource` singleton (already the transport for every other SSE
// consumer) and filter its `execution_output` events by `sessionId` in the
// handler, so all execution streams share the one connection instead of each
// mounting its own.
const SSE_ENABLED = false;

/**
 * SSE-based execution stream hook
 *
 * @param sessionId - Agent session ID to subscribe to / 購読するエージェントセッションID
 * @returns Execution stream state and control methods
 */
export function useExecutionStream(sessionId: number | null) {
  const t = useTranslations('devMode.useExecutionStreamSSE');
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
        logsRef.current = [`${t('startedLog')}\n`];
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
          logsRef.current = trimLogs([...logsRef.current, `\n${t('completedLog')}\n`]);
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'completed',
            logs: logsRef.current,
            result: data.result,
          }));
        } catch {
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'completed',
            logs: [...logsRef.current, `\n${t('completedShortLog')}\n`],
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
            `\n[Error] ${data.error?.errorMessage || t('failedLog')}\n`,
          ]);
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'failed',
            logs: logsRef.current,
            error: data.error?.errorMessage || t('failedLog'),
          }));
        } catch {
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'failed',
            logs: [...logsRef.current, '\n[Error] Execution failed\n'],
          }));
        }
      });

      // Cancellation event
      eventSource.addEventListener('execution_cancelled', (_event) => {
        logger.info('Execution cancelled');
        logsRef.current = trimLogs([...logsRef.current, `\n${t('cancelledLog')}\n`]);
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
        error: t('connectionFailed'),
      }));
    }
  }, [sessionId, t]);

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

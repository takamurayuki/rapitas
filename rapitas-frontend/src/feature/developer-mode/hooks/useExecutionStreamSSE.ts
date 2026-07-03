'use client';
// useExecutionStreamSSE

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { sharedEventSource } from '@/lib/sse/shared-event-source';
import { createLogger } from '@/lib/logger';
import { type ExecutionStreamState, trimLogs } from './execution-stream-types';

const logger = createLogger('ExecutionStream');

/** Shape shared by every `execution_*` SSE payload this hook cares about. */
type SessionScopedPayload = { sessionId?: number; [key: string]: unknown };

/**
 * SSE-based execution stream hook
 *
 * Subscribes through the app-wide `sharedEventSource` singleton (see
 * src/lib/sse/shared-event-source.ts) instead of opening a dedicated
 * EventSource per session. A per-session `new EventSource(...)` was disabled
 * here previously because Chromium/WebView2 caps concurrent connections at
 * ~6 per origin, and one execution panel mounting its own connection could
 * starve every other SSE consumer during auto-run (see that file's header
 * comment for the incident). Every `execution_*` broadcast now carries
 * `sessionId` in its payload (see event-bridge.ts's `handleOrchestratorEvent`),
 * so this hook filters the one shared stream down to the session it owns
 * instead of needing its own connection. `useExecutionPolling` remains the
 * fallback (and the only source of truth while this stream is disconnected).
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

  const logsRef = useRef<string[]>([]);
  // NOTE: `t` is read via a ref instead of being a subscription-effect
  // dependency — an unstable translator reference (recreated every render)
  // would otherwise re-run the effect below, which unconditionally calls
  // setState, on every render: an infinite loop. The ref always carries the
  // latest translator for the event handlers without forcing a resubscribe.
  const tRef = useRef(t);
  tRef.current = t;

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

  useEffect(() => {
    if (!sessionId) {
      setState((prev) => (prev.isConnected ? { ...prev, isConnected: false } : prev));
      return;
    }

    logsRef.current = [];
    setState((prev) => ({ ...prev, isConnected: sharedEventSource.isConnected(), error: null }));

    /**
     * Parse an event's JSON payload and drop it unless it belongs to this
     * hook's session — the shared connection delivers every execution's
     * events to every subscriber, so filtering here is what keeps one
     * session's log tail from bleeding into another's.
     *
     * @param event - Raw SSE MessageEvent from the shared connection / 共有接続からの生イベント
     * @returns The parsed payload when it matches this session, else null / このセッション宛の場合のみペイロードを返す
     */
    const forThisSession = <D extends SessionScopedPayload>(event: MessageEvent): D | null => {
      try {
        const data = JSON.parse(event.data) as D;
        return data.sessionId === sessionId ? data : null;
      } catch (e) {
        logger.error('Failed to parse SSE payload:', e);
        return null;
      }
    };

    const unsubscribers = [
      sharedEventSource.subscribe('execution_started', (event) => {
        if (!forThisSession(event)) return;
        logsRef.current = [`${tRef.current('startedLog')}\n`];
        setState((prev) => ({
          ...prev,
          isRunning: true,
          status: 'running',
          logs: logsRef.current,
        }));
      }),

      sharedEventSource.subscribe('execution_output', (event) => {
        const data = forThisSession<SessionScopedPayload & { output?: string }>(event);
        if (!data) return;
        const output = data.output || '';
        logsRef.current = trimLogs([...logsRef.current, output]);
        setState((prev) => ({ ...prev, logs: logsRef.current }));
      }),

      sharedEventSource.subscribe('execution_completed', (event) => {
        const data = forThisSession<SessionScopedPayload & { result?: unknown }>(event);
        if (!data) return;
        logsRef.current = trimLogs([...logsRef.current, `\n${tRef.current('completedLog')}\n`]);
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: 'completed',
          logs: logsRef.current,
          result: data.result,
        }));
      }),

      sharedEventSource.subscribe('execution_failed', (event) => {
        const data = forThisSession<SessionScopedPayload & { error?: { errorMessage?: string } }>(
          event,
        );
        if (!data) return;
        logsRef.current = trimLogs([
          ...logsRef.current,
          `\n[Error] ${data.error?.errorMessage || tRef.current('failedLog')}\n`,
        ]);
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: 'failed',
          logs: logsRef.current,
          error: data.error?.errorMessage || tRef.current('failedLog'),
        }));
      }),

      sharedEventSource.subscribe('execution_cancelled', (event) => {
        if (!forThisSession(event)) return;
        logsRef.current = trimLogs([...logsRef.current, `\n${tRef.current('cancelledLog')}\n`]);
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: 'cancelled',
          logs: logsRef.current,
        }));
      }),
    ];

    const unsubscribeConnection = sharedEventSource.onConnectionChange((connected) => {
      setState((prev) =>
        prev.isConnected === connected ? prev : { ...prev, isConnected: connected },
      );
    });

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribeConnection();
    };
  }, [sessionId]);

  // NOTE: connect/disconnect are kept as no-ops for API compatibility with any
  // external caller — subscription is now fully effect-driven (see above) via
  // the shared connection, which the rest of the app already keeps open.
  const connect = useCallback(() => {}, []);
  const disconnect = useCallback(() => {}, []);

  return {
    ...state,
    connect,
    disconnect,
    clearLogs,
  };
}

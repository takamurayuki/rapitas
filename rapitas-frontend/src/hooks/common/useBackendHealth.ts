'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useBackendHealth');

type BackendHealthStatus = 'connected' | 'disconnected' | 'checking';

type UseBackendHealthOptions = {
  /** Health check interval (milliseconds). Default: 5000 */
  intervalMs?: number;
  /** Retry interval after disconnect detection (milliseconds). Default: 2000 */
  retryIntervalMs?: number;
  /** Callback called on reconnection */
  onReconnectAction?: () => void;
  /** Callback called on disconnection */
  onDisconnectAction?: () => void;
};

/**
 * Hook for monitoring backend connection status and detecting recovery after restart.
 * Calls onReconnect callback when disconnect→recovery is detected.
 * When shutdown event is received via SSE, treats it as intentional restart
 * and sets isIntentionalRestart flag to true.
 */
export function useBackendHealth(options: UseBackendHealthOptions = {}) {
  const {
    intervalMs = 5000,
    retryIntervalMs = 2000,
    onReconnectAction,
    onDisconnectAction,
  } = options;

  const [status, setStatus] = useState<BackendHealthStatus>('checking');
  const [isIntentionalRestart, setIsIntentionalRestart] = useState(false);
  const wasDisconnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnectAction);
  const onDisconnectRef = useRef(onDisconnectAction);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    onReconnectRef.current = onReconnectAction;
  }, [onReconnectAction]);

  useEffect(() => {
    onDisconnectRef.current = onDisconnectAction;
  }, [onDisconnectAction]);

  // Detect shutdown events via SSE connection
  useEffect(() => {
    const connectSSE = () => {
      try {
        const es = new EventSource(`${API_BASE_URL}/events/stream`);
        eventSourceRef.current = es;

        es.addEventListener('shutdown', () => {
          logger.info('Received shutdown event - server is intentionally restarting');
          setIsIntentionalRestart(true);
        });

        es.onerror = () => {
          // NOTE: Ignore SSE connection errors (detected by health check polling)
          es.close();
          eventSourceRef.current = null;
        };
      } catch {
        // Ignore EventSource creation failure
      }
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${API_BASE_URL}/events/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        if (wasDisconnectedRef.current) {
          wasDisconnectedRef.current = false;
          setIsIntentionalRestart(false);
          logger.info('Backend reconnected');
          onReconnectRef.current?.();

          // Reconnect SSE after recovery
          if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
            try {
              const es = new EventSource(`${API_BASE_URL}/events/stream`);
              eventSourceRef.current = es;
              es.addEventListener('shutdown', () => {
                logger.info('Received shutdown event - server is intentionally restarting');
                setIsIntentionalRestart(true);
              });
              es.onerror = () => {
                es.close();
                eventSourceRef.current = null;
              };
            } catch {
              // Ignore EventSource creation failure
            }
          }
        }
        setStatus('connected');
      } else {
        if (!wasDisconnectedRef.current) {
          wasDisconnectedRef.current = true;
          logger.warn(`Backend disconnected: ${res.status} ${res.statusText}`);
          onDisconnectRef.current?.();
        }
        setStatus('disconnected');
      }
    } catch (error) {
      // Determine if error is a timeout error
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const errorMessage = isTimeout
        ? 'Request timeout'
        : error instanceof Error
          ? error.message
          : 'Unknown error';

      if (!wasDisconnectedRef.current) {
        wasDisconnectedRef.current = true;
        logger.warn(`Backend health check failed: ${errorMessage}`, error);
        onDisconnectRef.current?.();
      }
      setStatus('disconnected');
    }
  }, []);

  // Single interval that adjusts based on status
  useEffect(() => {
    // Run initial check asynchronously
    const initialCheck = setTimeout(() => checkHealth(), 0);

    const currentInterval = status === 'disconnected' ? retryIntervalMs : intervalMs;
    const timer = setInterval(checkHealth, currentInterval);

    return () => {
      clearTimeout(initialCheck);
      clearInterval(timer);
    };
  }, [checkHealth, status, intervalMs, retryIntervalMs]);

  return { status, isConnected: status === 'connected', isIntentionalRestart };
}

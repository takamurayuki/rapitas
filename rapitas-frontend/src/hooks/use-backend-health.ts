'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useBackendHealth');

type BackendHealthStatus = 'connected' | 'disconnected' | 'checking';

type UseBackendHealthOptions = {
  /** ヘルスチェック間隔（ミリ秒）。デフォルト: 5000 */
  intervalMs?: number;
  /** 切断検知後のリトライ間隔（ミリ秒）。デフォルト: 2000 */
  retryIntervalMs?: number;
  /** 再接続時に呼ばれるコールバック */
  onReconnectAction?: () => void;
  /** 切断時に呼ばれるコールバック */
  onDisconnectAction?: () => void;
};

/**
 * バックエンドの接続状態を監視し、再起動後の復帰を検知するフック。
 * 切断→復帰を検知した場合に onReconnect コールバックを呼び出す。
 * SSE経由でshutdownイベントを受信した場合は意図的な再起動として扱い、
 * isIntentionalRestartフラグをtrueにする。
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

  // SSE接続でshutdownイベントを検出
  useEffect(() => {
    const connectSSE = () => {
      try {
        const es = new EventSource(`${API_BASE_URL}/events/stream`);
        eventSourceRef.current = es;

        es.addEventListener('shutdown', () => {
          logger.info(
            'Received shutdown event - server is intentionally restarting',
          );
          setIsIntentionalRestart(true);
        });

        es.onerror = () => {
          // SSE接続エラーは無視（ヘルスチェックポーリングで検出する）
          es.close();
          eventSourceRef.current = null;
        };
      } catch {
        // EventSource作成失敗は無視
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

          // 再接続後にSSEも再接続
          if (
            !eventSourceRef.current ||
            eventSourceRef.current.readyState === EventSource.CLOSED
          ) {
            try {
              const es = new EventSource(`${API_BASE_URL}/events/stream`);
              eventSourceRef.current = es;
              es.addEventListener('shutdown', () => {
                logger.info(
                  'Received shutdown event - server is intentionally restarting',
                );
                setIsIntentionalRestart(true);
              });
              es.onerror = () => {
                es.close();
                eventSourceRef.current = null;
              };
            } catch {
              // EventSource作成失敗は無視
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
      // タイムアウトエラーかどうかを判定
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

  // status に応じて間隔を切り替える単一のインターバル
  useEffect(() => {
    // 初回チェックを非同期で実行
    const initialCheck = setTimeout(() => checkHealth(), 0);

    const currentInterval =
      status === 'disconnected' ? retryIntervalMs : intervalMs;
    const timer = setInterval(checkHealth, currentInterval);

    return () => {
      clearTimeout(initialCheck);
      clearInterval(timer);
    };
  }, [checkHealth, status, intervalMs, retryIntervalMs]);

  return { status, isConnected: status === 'connected', isIntentionalRestart };
}

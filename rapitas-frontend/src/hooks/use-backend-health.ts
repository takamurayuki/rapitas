'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from "@/lib/logger";

const logger = createLogger("useBackendHealth");

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
 */
export function useBackendHealth(options: UseBackendHealthOptions = {}) {
  const {
    intervalMs = 5000,
    retryIntervalMs = 2000,
    onReconnectAction,
    onDisconnectAction,
  } = options;

  const [status, setStatus] = useState<BackendHealthStatus>('checking');
  const wasDisconnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnectAction);
  const onDisconnectRef = useRef(onDisconnectAction);

  useEffect(() => {
    onReconnectRef.current = onReconnectAction;
  }, [onReconnectAction]);

  useEffect(() => {
    onDisconnectRef.current = onDisconnectAction;
  }, [onDisconnectAction]);

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
          logger.info('Backend reconnected');
          onReconnectRef.current?.();
        }
        setStatus('connected');
      } else {
        if (!wasDisconnectedRef.current) {
          wasDisconnectedRef.current = true;
          logger.warn(
            `Backend disconnected: ${res.status} ${res.statusText}`,
          );
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
        logger.warn(
          `Backend health check failed: ${errorMessage}`,
          error,
        );
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

  return { status, isConnected: status === 'connected' };
}

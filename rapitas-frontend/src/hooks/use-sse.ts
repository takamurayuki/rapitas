'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useSSE');

// SSEイベントの型定義
export type SSEEventType =
  | 'start'
  | 'progress'
  | 'data'
  | 'error'
  | 'retry'
  | 'rollback'
  | 'complete';

export interface SSEEvent<T = unknown> {
  type: SSEEventType;
  data: T;
  timestamp: string;
  retryCount?: number;
  maxRetries?: number;
}

export interface SSEProgressData {
  progress: number;
  message: string;
  [key: string]: unknown;
}

export interface SSERetryData {
  retryCount: number;
  maxRetries: number;
  reason: string;
  nextRetryIn: number;
}

export interface SSERollbackData {
  originalState: unknown;
  rollbackReason: string;
  timestamp: string;
  errorDetails: string;
}

export interface SSEErrorData {
  error: string;
  details?: unknown;
  rollback?: boolean;
  retryCount?: number;
  maxRetries?: number;
}

export interface UseSSEOptions<T> {
  onStart?: () => void;
  onProgress?: (data: SSEProgressData) => void;
  onData?: (data: T) => void;
  onError?: (data: SSEErrorData) => void;
  onRetry?: (data: SSERetryData) => void;
  onRollback?: (data: SSERollbackData) => void;
  onComplete?: (data: unknown) => void;
  onConnectionError?: (error: Error) => void;
}

export interface UseSSEReturn<T> {
  isConnected: boolean;
  isLoading: boolean;
  progress: number;
  progressMessage: string;
  data: T | null;
  error: SSEErrorData | null;
  retryInfo: SSERetryData | null;
  rollbackInfo: SSERollbackData | null;
  connect: (url: string) => void;
  disconnect: () => void;
  reset: () => void;
}

export function useSSE<T = unknown>(
  options: UseSSEOptions<T> = {},
): UseSSEReturn<T> {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<SSEErrorData | null>(null);
  const [retryInfo, setRetryInfo] = useState<SSERetryData | null>(null);
  const [rollbackInfo, setRollbackInfo] = useState<SSERollbackData | null>(
    null,
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);

  // オプションを最新に保つ
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 接続を閉じる
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
    setIsLoading(false);
  }, []);

  // 状態をリセット
  const reset = useCallback(() => {
    disconnect();
    setProgress(0);
    setProgressMessage('');
    setData(null);
    setError(null);
    setRetryInfo(null);
    setRollbackInfo(null);
  }, [disconnect]);

  // SSE接続を開始
  const connect = useCallback(
    (url: string) => {
      // 既存の接続を閉じる
      disconnect();

      // 状態をリセット
      setProgress(0);
      setProgressMessage('');
      setData(null);
      setError(null);
      setRetryInfo(null);
      setRollbackInfo(null);
      setIsLoading(true);

      try {
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsConnected(true);
        };

        eventSource.onerror = (event) => {
          logger.warn('SSE connection error:', event);
          const connectionError = new Error('SSE接続でエラーが発生しました');
          optionsRef.current.onConnectionError?.(connectionError);
          setError({
            error:
              '接続エラーが発生しました。ネットワーク接続を確認してください。',
          });
          disconnect();
        };

        // イベントハンドラを設定
        eventSource.addEventListener('start', (event) => {
          try {
            const parsed: SSEEvent = JSON.parse(event.data);
            optionsRef.current.onStart?.();
          } catch (e) {
            logger.errorThrottled('Failed to parse start event:', e);
          }
        });

        eventSource.addEventListener('progress', (event) => {
          try {
            const parsed: SSEEvent<SSEProgressData> = JSON.parse(event.data);
            setProgress(parsed.data.progress);
            setProgressMessage(parsed.data.message);
            optionsRef.current.onProgress?.(parsed.data);
          } catch (e) {
            logger.errorThrottled('Failed to parse progress event:', e);
          }
        });

        eventSource.addEventListener('data', (event) => {
          try {
            const parsed: SSEEvent<T> = JSON.parse(event.data);
            setData(parsed.data);
            optionsRef.current.onData?.(parsed.data);
          } catch (e) {
            logger.errorThrottled('Failed to parse data event:', e);
          }
        });

        eventSource.addEventListener('error', (event) => {
          try {
            // MessageEventの場合のみパース
            if (event instanceof MessageEvent) {
              const parsed: SSEEvent<SSEErrorData> = JSON.parse(event.data);
              setError(parsed.data);
              optionsRef.current.onError?.(parsed.data);
            }
          } catch (e) {
            logger.errorThrottled('Failed to parse error event:', e);
          }
        });

        eventSource.addEventListener('retry', (event) => {
          try {
            const parsed: SSEEvent<SSERetryData> = JSON.parse(event.data);
            setRetryInfo(parsed.data);
            optionsRef.current.onRetry?.(parsed.data);
          } catch (e) {
            logger.errorThrottled('Failed to parse retry event:', e);
          }
        });

        eventSource.addEventListener('rollback', (event) => {
          try {
            const parsed: SSEEvent<SSERollbackData> = JSON.parse(event.data);
            setRollbackInfo(parsed.data);
            optionsRef.current.onRollback?.(parsed.data);
          } catch (e) {
            logger.errorThrottled('Failed to parse rollback event:', e);
          }
        });

        eventSource.addEventListener('complete', (event) => {
          try {
            const parsed: SSEEvent = JSON.parse(event.data);
            setIsLoading(false);
            setProgress(100);
            optionsRef.current.onComplete?.(parsed.data);
            disconnect();
          } catch (e) {
            logger.errorThrottled('Failed to parse complete event:', e);
          }
        });
      } catch (err) {
        logger.error('Failed to create EventSource:', err);
        const connectionError =
          err instanceof Error ? err : new Error('SSE接続の作成に失敗しました');
        optionsRef.current.onConnectionError?.(connectionError);
        setError({
          error: '接続の作成に失敗しました。',
        });
        setIsLoading(false);
      }
    },
    [disconnect],
  );

  // コンポーネントのアンマウント時にクリーンアップ
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isLoading,
    progress,
    progressMessage,
    data,
    error,
    retryInfo,
    rollbackInfo,
    connect,
    disconnect,
    reset,
  };
}

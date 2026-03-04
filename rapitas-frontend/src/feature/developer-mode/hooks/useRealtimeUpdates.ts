import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  SSEEvent,
  ExecutionOutputEvent,
  ExecutionStatusEvent,
  GitHubEventData,
} from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useRealtimeUpdates');

export type EventHandler<T = unknown> = (data: T) => void;

export type UseRealtimeUpdatesOptions = {
  channels?: string[];
  autoConnect?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
};

export type UseRealtimeUpdatesReturn = {
  isConnected: boolean;
  lastEvent: SSEEvent | null;
  connect: () => void;
  disconnect: () => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  onExecutionOutput: (
    handler: EventHandler<ExecutionOutputEvent>,
  ) => () => void;
  onExecutionStatus: (
    handler: EventHandler<ExecutionStatusEvent>,
  ) => () => void;
  onGitHubEvent: (handler: EventHandler<GitHubEventData>) => () => void;
  onNotification: (handler: EventHandler<unknown>) => () => void;
};

export function useRealtimeUpdates(
  options: UseRealtimeUpdatesOptions = {},
): UseRealtimeUpdatesReturn {
  const {
    channels = ['*'],
    autoConnect = true,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  // channels配列を安定化（参照の変化による無限ループを防止）
  const channelsKey = channels.join(',');
  const stableChannels = useMemo(() => channels, [channelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  // コールバックをrefで保持して依存配列を安定化
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
  }, [onConnect, onDisconnect, onError]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      return;
    }

    const channelParam = stableChannels.join(',');
    const url = `${API_BASE_URL}/events/subscribe/${channelParam}`;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      onConnectRef.current?.();
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      onErrorRef.current?.(new Error('SSE connection error'));
      onDisconnectRef.current?.();
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const sseEvent: SSEEvent = {
          type: event.type || 'message',
          data,
          id: event.lastEventId || undefined,
          timestamp: new Date().toISOString(),
        };
        setLastEvent(sseEvent);

        // イベントタイプに基づいてハンドラを呼び出す
        const handlers = handlersRef.current.get(sseEvent.type);
        if (handlers) {
          handlers.forEach((handler) => handler(data));
        }

        // ワイルドカードハンドラ
        const wildcardHandlers = handlersRef.current.get('*');
        if (wildcardHandlers) {
          wildcardHandlers.forEach((handler) => handler(sseEvent));
        }
      } catch (err) {
        logger.error('Failed to parse SSE event:', err);
      }
    };

    // 特定のイベントタイプをリッスン
    const eventTypes = [
      'execution_output',
      'execution_status',
      'execution_started',
      'execution_completed',
      'execution_failed',
      'pull_request',
      'issue',
      'new_notification',
      'connected',
      'ping',
    ];

    eventTypes.forEach((type) => {
      eventSource.addEventListener(type, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          const sseEvent: SSEEvent = {
            type,
            data,
            id: event.lastEventId || undefined,
            timestamp: new Date().toISOString(),
          };
          setLastEvent(sseEvent);

          const handlers = handlersRef.current.get(type);
          if (handlers) {
            handlers.forEach((handler) => handler(data));
          }
        } catch (err) {
          logger.error(`Failed to parse ${type} event:`, err);
        }
      });
    });
  }, [stableChannels]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
      onDisconnectRef.current?.();
    }
  }, []);

  const subscribe = useCallback((channel: string) => {
    // 新しいチャンネルに購読するには再接続が必要
    // この実装では簡略化のため、初期接続時のチャンネルのみサポート
    logger.debug(`Subscribing to channel: ${channel}`);
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    logger.debug(`Unsubscribing from channel: ${channel}`);
  }, []);

  const addHandler = useCallback((eventType: string, handler: EventHandler) => {
    if (!handlersRef.current.has(eventType)) {
      handlersRef.current.set(eventType, new Set());
    }
    handlersRef.current.get(eventType)!.add(handler);

    return () => {
      handlersRef.current.get(eventType)?.delete(handler);
    };
  }, []);

  const onExecutionOutput = useCallback(
    (handler: EventHandler<ExecutionOutputEvent>) => {
      return addHandler('execution_output', handler as EventHandler);
    },
    [addHandler],
  );

  const onExecutionStatus = useCallback(
    (handler: EventHandler<ExecutionStatusEvent>) => {
      return addHandler('execution_status', handler as EventHandler);
    },
    [addHandler],
  );

  const onGitHubEvent = useCallback(
    (handler: EventHandler<GitHubEventData>) => {
      const unsubPR = addHandler('pull_request', handler as EventHandler);
      const unsubIssue = addHandler('issue', handler as EventHandler);
      return () => {
        unsubPR();
        unsubIssue();
      };
    },
    [addHandler],
  );

  const onNotification = useCallback(
    (handler: EventHandler<unknown>) => {
      return addHandler('new_notification', handler as EventHandler);
    },
    [addHandler],
  );

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isConnected,
    lastEvent,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    onExecutionOutput,
    onExecutionStatus,
    onGitHubEvent,
    onNotification,
  };
}

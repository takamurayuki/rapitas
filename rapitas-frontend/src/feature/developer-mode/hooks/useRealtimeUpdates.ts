import { useState, useEffect, useCallback, useRef } from "react";
import type { SSEEvent, ExecutionOutputEvent, ExecutionStatusEvent, GitHubEventData } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

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
  onExecutionOutput: (handler: EventHandler<ExecutionOutputEvent>) => () => void;
  onExecutionStatus: (handler: EventHandler<ExecutionStatusEvent>) => () => void;
  onGitHubEvent: (handler: EventHandler<GitHubEventData>) => () => void;
  onNotification: (handler: EventHandler<unknown>) => () => void;
};

export function useRealtimeUpdates(
  options: UseRealtimeUpdatesOptions = {}
): UseRealtimeUpdatesReturn {
  const {
    channels = ["*"],
    autoConnect = true,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      return;
    }

    const channelParam = channels.join(",");
    const url = `${API_BASE_URL}/events/subscribe/${channelParam}`;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      onConnect?.();
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      onError?.(new Error("SSE connection error"));
      onDisconnect?.();
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const sseEvent: SSEEvent = {
          type: event.type || "message",
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
        const wildcardHandlers = handlersRef.current.get("*");
        if (wildcardHandlers) {
          wildcardHandlers.forEach((handler) => handler(sseEvent));
        }
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
      }
    };

    // 特定のイベントタイプをリッスン
    const eventTypes = [
      "execution_output",
      "execution_status",
      "execution_started",
      "execution_completed",
      "execution_failed",
      "pull_request",
      "issue",
      "new_notification",
      "connected",
      "ping",
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
          console.error(`Failed to parse ${type} event:`, err);
        }
      });
    });
  }, [channels, onConnect, onDisconnect, onError]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
      onDisconnect?.();
    }
  }, [onDisconnect]);

  const subscribe = useCallback((channel: string) => {
    // 新しいチャンネルに購読するには再接続が必要
    // この実装では簡略化のため、初期接続時のチャンネルのみサポート
    console.log(`Subscribing to channel: ${channel}`);
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    console.log(`Unsubscribing from channel: ${channel}`);
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
      return addHandler("execution_output", handler as EventHandler);
    },
    [addHandler]
  );

  const onExecutionStatus = useCallback(
    (handler: EventHandler<ExecutionStatusEvent>) => {
      return addHandler("execution_status", handler as EventHandler);
    },
    [addHandler]
  );

  const onGitHubEvent = useCallback(
    (handler: EventHandler<GitHubEventData>) => {
      const unsubPR = addHandler("pull_request", handler as EventHandler);
      const unsubIssue = addHandler("issue", handler as EventHandler);
      return () => {
        unsubPR();
        unsubIssue();
      };
    },
    [addHandler]
  );

  const onNotification = useCallback(
    (handler: EventHandler<unknown>) => {
      return addHandler("new_notification", handler as EventHandler);
    },
    [addHandler]
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

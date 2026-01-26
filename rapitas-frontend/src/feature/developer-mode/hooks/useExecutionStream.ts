"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export type ExecutionEventData = {
  output?: string;
  result?: unknown;
  error?: { errorMessage?: string };
  [key: string]: unknown;
};

export type ExecutionEvent = {
  type: "started" | "output" | "completed" | "failed" | "cancelled";
  data: ExecutionEventData;
  timestamp: string;
};

export type ExecutionStreamState = {
  isConnected: boolean;
  isRunning: boolean;
  logs: string[];
  status: "idle" | "running" | "completed" | "failed" | "cancelled" | "waiting_for_input";
  error: string | null;
  result: unknown | null;
  waitingForInput?: boolean;
  question?: string;
};

export function useExecutionStream(sessionId: number | null) {
  const [state, setState] = useState<ExecutionStreamState>({
    isConnected: false,
    isRunning: false,
    logs: [],
    status: "idle",
    error: null,
    result: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const logsRef = useRef<string[]>([]);

  const connect = useCallback(() => {
    if (!sessionId || eventSourceRef.current) return;

    const channel = `session:${sessionId}`;
    const url = `${API_BASE_URL}/events/stream/${encodeURIComponent(channel)}`;

    console.log("[ExecutionStream] Connecting to:", url);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[ExecutionStream] Connected");
      setState((prev) => ({ ...prev, isConnected: true }));
    };

    eventSource.onerror = (error) => {
      console.error("[ExecutionStream] Error:", error);
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: "接続エラーが発生しました",
      }));
    };

    // 実行開始イベント
    eventSource.addEventListener("execution_started", (event) => {
      console.log("[ExecutionStream] Execution started:", event.data);
      logsRef.current = ["[開始] エージェントの実行を開始しました...\n"];
      setState((prev) => ({
        ...prev,
        isRunning: true,
        status: "running",
        logs: logsRef.current,
      }));
    });

    // 出力イベント
    eventSource.addEventListener("execution_output", (event) => {
      try {
        const data = JSON.parse(event.data);
        const output = data.output || "";
        logsRef.current = [...logsRef.current, output];
        setState((prev) => ({
          ...prev,
          logs: logsRef.current,
        }));
      } catch (e) {
        console.error("[ExecutionStream] Failed to parse output:", e);
      }
    });

    // 完了イベント
    eventSource.addEventListener("execution_completed", (event) => {
      console.log("[ExecutionStream] Execution completed:", event.data);
      try {
        const data = JSON.parse(event.data);
        logsRef.current = [
          ...logsRef.current,
          "\n[完了] エージェントの実行が完了しました。\n",
        ];
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: "completed",
          logs: logsRef.current,
          result: data.result,
        }));
      } catch (e) {
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: "completed",
          logs: [...logsRef.current, "\n[完了] 実行完了\n"],
        }));
      }
    });

    // 失敗イベント
    eventSource.addEventListener("execution_failed", (event) => {
      console.log("[ExecutionStream] Execution failed:", event.data);
      try {
        const data = JSON.parse(event.data);
        logsRef.current = [
          ...logsRef.current,
          `\n[エラー] ${data.error?.errorMessage || "実行に失敗しました"}\n`,
        ];
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: "failed",
          logs: logsRef.current,
          error: data.error?.errorMessage || "実行に失敗しました",
        }));
      } catch (e) {
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: "failed",
          logs: [...logsRef.current, "\n[エラー] 実行失敗\n"],
        }));
      }
    });

    // キャンセルイベント
    eventSource.addEventListener("execution_cancelled", (event) => {
      console.log("[ExecutionStream] Execution cancelled");
      logsRef.current = [
        ...logsRef.current,
        "\n[キャンセル] 実行がキャンセルされました。\n",
      ];
      setState((prev) => ({
        ...prev,
        isRunning: false,
        status: "cancelled",
        logs: logsRef.current,
      }));
    });

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
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
      status: "idle",
      error: null,
      result: null,
    }));
  }, []);

  // sessionIdが変わったら再接続
  useEffect(() => {
    if (sessionId) {
      connect();
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

/**
 * ポーリングベースの実行状態フック（SSEが使えない場合のフォールバック）
 */
export function useExecutionPolling(taskId: number | null) {
  const [state, setState] = useState<ExecutionStreamState>({
    isConnected: false,
    isRunning: false,
    logs: [],
    status: "idle",
    error: null,
    result: null,
    waitingForInput: false,
    question: undefined,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastOutputLengthRef = useRef(0);

  const startPolling = useCallback(async () => {
    console.log("[ExecutionPolling] startPolling called, taskId:", taskId, "intervalRef:", intervalRef.current);
    if (!taskId || intervalRef.current) {
      console.log("[ExecutionPolling] Skipping - taskId:", taskId, "intervalRef exists:", !!intervalRef.current);
      return;
    }

    console.log("[ExecutionPolling] Starting polling for task:", taskId);
    setState((prev) => ({ ...prev, isConnected: true, isRunning: true, status: "running" }));

    const poll = async () => {
      try {
        console.log("[ExecutionPolling] Polling...");
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execution-status`);
        if (!res.ok) {
          console.log("[ExecutionPolling] Response not ok:", res.status);
          return;
        }

        const data = await res.json();
        console.log("[ExecutionPolling] Got data:", {
          executionStatus: data.executionStatus,
          outputLength: data.output?.length || 0,
          errorMessage: data.errorMessage,
        });

        if (data.output) {
          // 新しい出力があれば追加
          const newOutput = data.output.slice(lastOutputLengthRef.current);
          if (newOutput) {
            console.log("[ExecutionPolling] New output:", newOutput.substring(0, 100));
            lastOutputLengthRef.current = data.output.length;
            setState((prev) => ({
              ...prev,
              logs: [...prev.logs, newOutput],
            }));
          }
        }

        if (data.executionStatus === "completed") {
          console.log("[ExecutionPolling] Execution completed");
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: "completed",
            waitingForInput: false,
            question: undefined,
            logs: [...prev.logs, "\n[完了] 実行が完了しました。\n"],
          }));
          stopPolling();
        } else if (data.executionStatus === "failed") {
          console.log("[ExecutionPolling] Execution failed:", data.errorMessage);
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: "failed",
            waitingForInput: false,
            error: data.errorMessage,
            logs: [...prev.logs, `\n[エラー] ${data.errorMessage || "実行失敗"}\n`],
          }));
          stopPolling();
        } else if (data.executionStatus === "waiting_for_input" || data.waitingForInput) {
          console.log("[ExecutionPolling] Waiting for input:", data.question);
          setState((prev) => ({
            ...prev,
            isRunning: true, // まだ実行中扱い（応答待ち）
            status: "waiting_for_input",
            waitingForInput: true,
            question: data.question || "",
          }));
          // ポーリングは継続（応答後にステータスが変わる）
        }
      } catch (error) {
        console.error("[ExecutionPolling] Error:", error);
      }
    };

    // 初回実行
    await poll();

    // 0.5秒ごとにポーリング（リアルタイム更新）
    intervalRef.current = setInterval(poll, 500);
  }, [taskId]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  const clearLogs = useCallback(() => {
    lastOutputLengthRef.current = 0;
    setState({
      isConnected: false,
      isRunning: false,
      logs: [],
      status: "idle",
      error: null,
      result: null,
      waitingForInput: false,
      question: undefined,
    });
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
  };
}

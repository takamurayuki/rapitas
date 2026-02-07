"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "@/utils/api";

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

/**
 * 質問の種類を表す型
 * - 'tool_call': Claude CodeのAskUserQuestionツール呼び出しによる質問（AIエージェントからの明確なステータス）
 * - 'none': 質問なし
 *
 * 注意: 'pattern_match'は廃止。AIエージェントからの明確なステータスのみを信頼する。
 */
export type QuestionType = "tool_call" | "none";

/**
 * 質問タイムアウト情報
 */
export type QuestionTimeoutInfo = {
  /** 残り秒数 */
  remainingSeconds: number;
  /** タイムアウト期限 */
  deadline: string;
  /** トータル秒数 */
  totalSeconds: number;
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
  /** 質問の検出方法（tool_call: AskUserQuestionツール呼び出し, none: 質問なし） */
  questionType?: QuestionType;
  /** 質問タイムアウト情報（質問待ち状態の場合のみ） */
  questionTimeout?: QuestionTimeoutInfo;
};

// SSEは現在無効化（ポーリングをメインで使用）
const SSE_ENABLED = false;

// ログ配列の最大エントリ数（メモリリーク防止）
const MAX_LOG_ENTRIES = 500;

/** ログ配列が上限を超えないようにトリミングする */
function trimLogs(logs: string[]): string[] {
  if (logs.length <= MAX_LOG_ENTRIES) return logs;
  return logs.slice(-MAX_LOG_ENTRIES);
}

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
    // SSEが無効の場合は何もしない
    if (!SSE_ENABLED) {
      console.log("[ExecutionStream] SSE disabled, using polling instead");
      return;
    }

    if (!sessionId) {
      console.log("[ExecutionStream] No sessionId, skipping connection");
      return;
    }
    if (eventSourceRef.current) {
      console.log("[ExecutionStream] Already connected, skipping");
      return;
    }

    const channel = `session:${sessionId}`;
    const url = `${API_BASE_URL}/events/subscribe/${encodeURIComponent(channel)}`;

    console.log("[ExecutionStream] Connecting to:", url);

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[ExecutionStream] Connection opened");
      setState((prev) => ({ ...prev, isConnected: true, error: null }));
    };

    eventSource.onerror = () => {
      // EventSourceのエラーは接続の再試行を示す場合もあるため、
      // readyStateをチェックして本当のエラーかどうか判定
      if (eventSource.readyState === EventSource.CLOSED) {
        console.log("[ExecutionStream] Connection closed, will use polling fallback");
        eventSourceRef.current = null;
        setState((prev) => ({
          ...prev,
          isConnected: false,
          // エラーメッセージは表示しない（ポーリングがフォールバックとして機能する）
        }));
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        // 再接続中の場合はログのみ
        console.log("[ExecutionStream] Reconnecting...");
      }
    };

    // 接続確認イベント（サーバーから送信）
    eventSource.addEventListener("connected", (event) => {
      console.log("[ExecutionStream] Connected event received:", event.data);
      setState((prev) => ({ ...prev, isConnected: true, error: null }));
    });

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
        logsRef.current = trimLogs([...logsRef.current, output]);
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
        logsRef.current = trimLogs([
          ...logsRef.current,
          "\n[完了] エージェントの実行が完了しました。\n",
        ]);
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
        logsRef.current = trimLogs([
          ...logsRef.current,
          `\n[エラー] ${data.error?.errorMessage || "実行に失敗しました"}\n`,
        ]);
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
      logsRef.current = trimLogs([
        ...logsRef.current,
        "\n[キャンセル] 実行がキャンセルされました。\n",
      ]);
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
    } catch (error) {
      console.error("[ExecutionStream] Failed to create EventSource:", error);
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: "SSE接続の作成に失敗しました",
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
    questionType: "none",
    questionTimeout: undefined,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastOutputLengthRef = useRef(0);
  // 終了ログが既に追加されたかを追跡（重複防止）
  const hasAddedFinalLogRef = useRef(false);
  // 最後に処理したステータスを追跡（同一ステータスの重複処理防止）
  const lastProcessedStatusRef = useRef<string | null>(null);
  // 最後に処理した質問を追跡（質問の重複処理防止）
  const lastProcessedQuestionRef = useRef<string | null>(null);

  /**
   * ポーリングを開始する
   * @param options.initialOutput 復元時の初期出力（指定された場合はログをリセットせず、この位置から差分を取得）
   * @param options.preserveLogs trueの場合、既存のログを保持する
   */
  const startPolling = useCallback(async (options?: { initialOutput?: string; preserveLogs?: boolean }) => {
    console.log("[ExecutionPolling] startPolling called, taskId:", taskId, "intervalRef:", intervalRef.current, "options:", options);
    if (!taskId || intervalRef.current) {
      console.log("[ExecutionPolling] Skipping - taskId:", taskId, "intervalRef exists:", !!intervalRef.current);
      return;
    }

    console.log("[ExecutionPolling] Starting polling for task:", taskId);

    // 終了ログフラグとステータス追跡をリセット
    hasAddedFinalLogRef.current = false;
    lastProcessedStatusRef.current = null;
    lastProcessedQuestionRef.current = null;

    // 初期出力がある場合はその長さから開始（復元時）
    if (options?.initialOutput) {
      lastOutputLengthRef.current = options.initialOutput.length;
      setState((prev) => ({
        ...prev,
        isConnected: true,
        isRunning: true,
        status: "running",
        logs: options.preserveLogs ? prev.logs : [options.initialOutput || ""],
      }));
    } else if (options?.preserveLogs) {
      // ログを保持する場合
      setState((prev) => ({
        ...prev,
        isConnected: true,
        isRunning: true,
        status: "running",
      }));
    } else {
      // 新規実行時はリセット
      lastOutputLengthRef.current = 0;
      setState((prev) => ({
        ...prev,
        isConnected: true,
        isRunning: true,
        status: "running",
        logs: [],
      }));
    }

    const poll = async () => {
      // キャンセル状態の場合はポーリングをスキップ（キャンセル後のステータス上書きを防止）
      if (lastProcessedStatusRef.current === "cancelled") {
        console.log("[ExecutionPolling] Skipping poll - already cancelled");
        return;
      }

      try {
        // タイムアウト付きのfetch（10秒）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execution-status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        // キャンセル状態になった場合は結果を無視
        if (lastProcessedStatusRef.current === "cancelled") {
          console.log("[ExecutionPolling] Ignoring result - cancelled during fetch");
          return;
        }

        if (!res.ok) {
          console.log("[ExecutionPolling] Response not ok:", res.status);
          return;
        }

        const data = await res.json();

        // 実行データがない場合はスキップ
        if (!data.executionStatus || data.status === "none") {
          console.log("[ExecutionPolling] No execution data yet");
          return;
        }

        // 出力を更新
        if (data.output) {
          const currentLength = lastOutputLengthRef.current;
          const newOutput = data.output.slice(currentLength);
          if (newOutput) {
            console.log("[ExecutionPolling] New output received:", newOutput.length, "chars");
            lastOutputLengthRef.current = data.output.length;
            setState((prev) => ({
              ...prev,
              logs: trimLogs([...prev.logs, newOutput]),
            }));
          }
        }

        // ステータスに応じて処理
        // 同一ステータスの重複処理を防止
        const currentStatus = data.executionStatus;
        const isStatusChanged = lastProcessedStatusRef.current !== currentStatus;

        if (data.executionStatus === "completed") {
          // 既に同じステータスを処理済みの場合はスキップ
          if (!isStatusChanged && hasAddedFinalLogRef.current) {
            return;
          }
          console.log("[ExecutionPolling] Execution completed");
          lastProcessedStatusRef.current = currentStatus;
          // 終了ログが未追加の場合のみ追加（重複防止）
          const shouldAddLog = !hasAddedFinalLogRef.current;
          if (shouldAddLog) {
            hasAddedFinalLogRef.current = true;
          }
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: "completed",
            waitingForInput: false,
            question: undefined,
            logs: shouldAddLog && prev.logs.length > 0
              ? trimLogs([...prev.logs, "\n[完了] 実行が完了しました。\n"])
              : shouldAddLog
                ? ["[完了] 実行が完了しました。\n"]
                : prev.logs,
          }));
          stopPolling();
        } else if (data.executionStatus === "failed") {
          // 既に同じステータスを処理済みの場合はスキップ
          if (!isStatusChanged && hasAddedFinalLogRef.current) {
            return;
          }
          console.log("[ExecutionPolling] Execution failed:", data.errorMessage);
          lastProcessedStatusRef.current = currentStatus;
          // 終了ログが未追加の場合のみ追加（重複防止）
          const shouldAddLog = !hasAddedFinalLogRef.current;
          if (shouldAddLog) {
            hasAddedFinalLogRef.current = true;
          }
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: "failed",
            waitingForInput: false,
            error: data.errorMessage,
            logs: shouldAddLog && prev.logs.length > 0
              ? trimLogs([...prev.logs, `\n[エラー] ${data.errorMessage || "実行失敗"}\n`])
              : shouldAddLog
                ? [`[エラー] ${data.errorMessage || "実行失敗"}\n`]
                : prev.logs,
          }));
          stopPolling();
        } else if (data.executionStatus === "cancelled") {
          // 既に同じステータスを処理済みの場合はスキップ
          if (!isStatusChanged && hasAddedFinalLogRef.current) {
            return;
          }
          console.log("[ExecutionPolling] Execution cancelled");
          lastProcessedStatusRef.current = currentStatus;
          // 終了ログが未追加の場合のみ追加（重複防止）
          const shouldAddLog = !hasAddedFinalLogRef.current;
          if (shouldAddLog) {
            hasAddedFinalLogRef.current = true;
          }
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: "cancelled",
            waitingForInput: false,
            logs: shouldAddLog && prev.logs.length > 0
              ? trimLogs([...prev.logs, "\n[キャンセル] 実行が停止されました。\n"])
              : shouldAddLog
                ? ["[キャンセル] 実行が停止されました。\n"]
                : prev.logs,
          }));
          stopPolling();
        } else if (data.executionStatus === "waiting_for_input" || data.waitingForInput) {
          // キャンセル状態の場合は上書きしない
          if (lastProcessedStatusRef.current === "cancelled") {
            return;
          }

          // 同じ質問を既に処理済みの場合はタイムアウト情報のみ更新
          const currentQuestion = data.question || "";
          const isNewQuestion =
            lastProcessedStatusRef.current !== "waiting_for_input" ||
            lastProcessedQuestionRef.current !== currentQuestion;

          // タイムアウト情報を取得
          const timeoutInfo: QuestionTimeoutInfo | undefined = data.questionTimeout
            ? {
                remainingSeconds: data.questionTimeout.remainingSeconds,
                deadline: data.questionTimeout.deadline,
                totalSeconds: data.questionTimeout.totalSeconds,
              }
            : undefined;

          if (isNewQuestion) {
            console.log("[ExecutionPolling] Waiting for input:", currentQuestion, "questionType:", data.questionType, "timeout:", timeoutInfo);
            lastProcessedStatusRef.current = "waiting_for_input";
            lastProcessedQuestionRef.current = currentQuestion;
          }

          setState((prev) => ({
            ...prev,
            isRunning: true,
            status: "waiting_for_input",
            waitingForInput: true,
            question: currentQuestion,
            // questionTypeはAPIからの値のみを使用（pattern_matchへのフォールバックは削除）
            // AIエージェントからの明確なステータス（tool_call）のみを信頼
            questionType: data.questionType === "tool_call" ? "tool_call" : "none",
            questionTimeout: timeoutInfo,
          }));
        } else if (data.executionStatus === "running") {
          // キャンセル状態の場合は上書きしない
          if (lastProcessedStatusRef.current === "cancelled") {
            return;
          }
          // 実行中の場合、isRunningをtrueに維持
          setState((prev) => ({
            ...prev,
            isRunning: true,
            status: "running",
          }));
        }
      } catch (error) {
        // AbortErrorはタイムアウトによるもの - 静かにスキップ
        if (error instanceof Error && error.name === 'AbortError') {
          console.log("[ExecutionPolling] Request timed out, will retry");
          return;
        }
        // TypeError: Failed to fetchはネットワークエラー - バックエンドが応答しない可能性
        if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
          console.warn("[ExecutionPolling] Network error - backend may be unresponsive");
          // 連続エラーをカウントし、一定回数超えたらエラー状態にする処理も可能
          return;
        }
        console.error("[ExecutionPolling] Error:", error);
      }
    };

    // 初回実行
    await poll();

    // 300msごとにポーリング（より高頻度でリアルタイム感を向上）
    intervalRef.current = setInterval(poll, 300);
  }, [taskId]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  /**
   * 実行をキャンセル状態に設定する（停止ボタン押下時に即座にUIを更新するため）
   */
  const setCancelled = useCallback(() => {
    // ポーリングを停止
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // 既にキャンセル処理済みの場合はスキップ
    if (lastProcessedStatusRef.current === "cancelled" && hasAddedFinalLogRef.current) {
      return;
    }
    lastProcessedStatusRef.current = "cancelled";
    // 終了ログが未追加の場合のみ追加
    const shouldAddLog = !hasAddedFinalLogRef.current;
    if (shouldAddLog) {
      hasAddedFinalLogRef.current = true;
    }
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isRunning: false,
      status: "cancelled",
      waitingForInput: false,
      question: undefined,
      logs: shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, "\n[キャンセル] 実行が停止されました。\n"])
        : shouldAddLog
          ? ["[キャンセル] 実行が停止されました。\n"]
          : prev.logs,
    }));
  }, []);

  const clearLogs = useCallback(() => {
    lastOutputLengthRef.current = 0;
    hasAddedFinalLogRef.current = false;
    lastProcessedStatusRef.current = null;
    lastProcessedQuestionRef.current = null;
    setState({
      isConnected: false,
      isRunning: false,
      logs: [],
      status: "idle",
      error: null,
      result: null,
      waitingForInput: false,
      question: undefined,
      questionType: "none",
      questionTimeout: undefined,
    });
  }, []);

  /**
   * 質問への回答が送信された後に質問状態をクリアする
   * ステータスは running に戻し、ログは保持する
   */
  const clearQuestion = useCallback(() => {
    // 質問のステータス追跡をリセットして、新しい質問を受け付けられるようにする
    lastProcessedStatusRef.current = "running";
    lastProcessedQuestionRef.current = null;
    setState((prev) => ({
      ...prev,
      status: "running",
      waitingForInput: false,
      question: undefined,
      questionType: "none",
      questionTimeout: undefined,
    }));
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
    setCancelled,
    clearQuestion,
  };
}

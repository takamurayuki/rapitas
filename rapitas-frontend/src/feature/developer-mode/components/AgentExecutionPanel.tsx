"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Rocket,
  Bot,
  GitBranch,
  FolderOpen,
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Square,
  RefreshCw,
  Send,
  HelpCircle,
  FileText,
} from "lucide-react";
import type {
  ExecutionStatus,
  ExecutionResult,
} from "../hooks/useDeveloperMode";
import {
  useExecutionPolling,
  useExecutionStream,
} from "../hooks/useExecutionStream";
import {
  ExecutionLogViewer,
  type ExecutionLogStatus,
} from "./ExecutionLogViewer";

type Props = {
  taskId: number;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  error: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean; // AIタスク分析を使用するか
  optimizedPrompt?: string | null; // 最適化されたプロンプト
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  // 実行状態復元用
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  // 実行停止時のコールバック（親コンポーネントの状態更新用）
  onStopExecution?: () => void;
  // 実行完了時のコールバック（親コンポーネントの状態更新用）
  onExecutionComplete?: () => void;
};

export function AgentExecutionPanel({
  taskId,
  isExecuting,
  executionStatus,
  executionResult,
  error,
  workingDirectory,
  defaultBranch,
  useTaskAnalysis,
  optimizedPrompt,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
  onExecutionComplete,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [showLogsExternal, setShowLogsExternal] = useState(false); // 外部（独立）でログを表示するか
  const [instruction, setInstruction] = useState("");
  const [branchName, setBranchName] = useState("");
  const [userResponse, setUserResponse] = useState("");
  const [isSendingResponse, setIsSendingResponse] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const hasRestoredRef = useRef(false);

  // SSEベースのリアルタイムログ取得
  const {
    logs: sseLogs,
    status: sseStatus,
    isRunning: isSseRunning,
    isConnected: isSseConnected,
    error: sseError,
    clearLogs: clearSseLogs,
  } = useExecutionStream(sessionId);

  // ポーリングベースのログ取得（フォールバック＆ステータス確認用）
  const {
    logs: pollingLogs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    questionType: pollingQuestionType,
    startPolling,
    stopPolling,
    clearLogs: clearPollingLogs,
    setCancelled: setPollingCancelled,
  } = useExecutionPolling(taskId);

  // SSEが接続されている場合はSSEのログを優先、そうでなければポーリングのログを使用
  // logs配列の参照を安定化させるためにuseMemoを使用
  const logs = useMemo(() => {
    return isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs;
  }, [isSseConnected, sseLogs, pollingLogs]);

  const clearLogs = useCallback(() => {
    clearSseLogs();
    clearPollingLogs();
  }, [clearSseLogs, clearPollingLogs]);

  // 質問の検出方法タイプ
  type QuestionType = "tool_call" | "pattern_match" | "none";

  // 質問検出: APIからの状態を優先、なければログから検出
  const detectQuestion = (
    logText: string,
  ): { hasQuestion: boolean; question: string; questionType: QuestionType } => {
    // APIから質問待ち状態が返されている場合はそれを使用（最も信頼性が高い）
    if (pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        questionType: pollingQuestionType || "pattern_match",
      };
    }

    if (!logText)
      return { hasQuestion: false, question: "", questionType: "none" };

    // 最後の数行を取得
    const lines = logText.split("\n").filter((l) => l.trim());
    const lastLines = lines.slice(-5).join("\n");

    // 質問パターンを検出
    const questionPatterns = [
      /\?[\s]*$/m, // ?で終わる行
      /please (choose|select|specify|confirm|provide|enter)/i,
      /which (one|option|file|directory)/i,
      /do you want/i,
      /would you like/i,
      /should I/i,
      /can you (tell|specify|provide)/i,
      /what (is|are|should)/i,
      /enter (your|a|the)/i,
      /input:/i,
      /y\/n/i,
      /\[y\/N\]/i,
      /\[Y\/n\]/i,
    ];

    const hasQuestion = questionPatterns.some((pattern) =>
      pattern.test(lastLines),
    );

    if (hasQuestion) {
      // 質問部分を抽出
      const questionLines = lines
        .slice(-3)
        .filter(
          (l) =>
            questionPatterns.some((p) => p.test(l)) || l.trim().endsWith("?"),
        );
      return {
        hasQuestion: true,
        question: questionLines.join("\n") || lastLines,
        questionType: "pattern_match", // フロントエンドでの検出はパターンマッチング
      };
    }

    return { hasQuestion: false, question: "", questionType: "none" };
  };

  const currentLogText = useMemo(() => logs.join(""), [logs]);

  // 質問検出の結果をメモ化
  const { hasQuestion, question, questionType } = useMemo(() => {
    return detectQuestion(currentLogText);
  }, [
    currentLogText,
    pollingWaitingForInput,
    pollingQuestion,
    pollingQuestionType,
  ]);

  // questionTypeがtool_callの場合はより確実に質問があることを示す
  const isConfirmedQuestion = questionType === "tool_call";

  // waiting_for_input状態の場合は、完了とは見なさない
  // ただし、pollingStatusまたはsseStatusが終了状態（completed, failed, cancelled）の場合は
  // 質問待ちではないと判断する（過去のログに質問パターンが残っていても無視）
  const isTerminalStatus =
    pollingStatus === "completed" ||
    pollingStatus === "failed" ||
    pollingStatus === "cancelled" ||
    sseStatus === "completed" ||
    sseStatus === "failed" ||
    sseStatus === "cancelled";
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === "waiting_for_input" ||
      pollingWaitingForInput ||
      hasQuestion);

  // マウント時に実行状態を復元
  useEffect(() => {
    const restoreState = async () => {
      // 既に復元済み、または復元関数がない場合はスキップ
      if (hasRestoredRef.current || !onRestoreExecutionState) {
        return;
      }
      // 既にsessionIdがある場合（新規実行中）はスキップ
      if (sessionId || executionResult?.sessionId) {
        return;
      }

      hasRestoredRef.current = true;
      setIsRestoring(true);

      try {
        const restoredState = await onRestoreExecutionState();
        if (restoredState) {
          setSessionId(restoredState.sessionId);
          // 復元時は既存の出力を初期値として渡す
          startPolling({
            initialOutput: restoredState.output,
            preserveLogs: false,
          });
          setShowLogs(true);
        }
      } catch (err) {
        // 復元失敗時は静かに失敗
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, [onRestoreExecutionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // 実行開始時にSSE接続とポーリングを開始
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;

  useEffect(() => {
    if (executionSessionId) {
      // SSE接続用にsessionIdを設定
      setSessionId(executionSessionId);
      // ポーリングも開始（フォールバック用）
      // 復元された実行の場合は初期出力を渡す
      if (executionOutput) {
        startPolling({
          initialOutput: executionOutput,
          preserveLogs: false,
        });
      } else {
        startPolling();
      }
    }
  }, [executionSessionId, executionOutput, startPolling]);

  // 実行中になったらポーリング開始
  useEffect(() => {
    if (isExecuting && !isPollingRunning) {
      startPolling();
    }
  }, [isExecuting, isPollingRunning, startPolling]);

  // ポーリングのステータスが完了/失敗/キャンセルになったら親コンポーネントを更新
  useEffect(() => {
    if (pollingStatus === "completed" || pollingStatus === "failed" || pollingStatus === "cancelled") {
      // 親コンポーネントの状態を更新して実行完了を通知
      if (onExecutionComplete) {
        onExecutionComplete();
      }
    }
  }, [pollingStatus, onExecutionComplete]);

  const handleExecute = async () => {
    clearLogs();
    const result = await onExecute({
      instruction: instruction.trim() || undefined,
      branchName: branchName.trim() || undefined,
      useTaskAnalysis, // AIタスク分析を使用するかどうかを渡す
      optimizedPrompt: optimizedPrompt || undefined, // 最適化されたプロンプトを渡す
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  const handleSendResponse = async () => {
    if (!userResponse.trim() || isSendingResponse) return;

    setIsSendingResponse(true);
    try {
      const API_BASE_URL =
        process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/agent-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: userResponse.trim() }),
      });

      if (res.ok) {
        setUserResponse("");
      } else {
        console.error("Failed to send response");
      }
    } catch (error) {
      console.error("Error sending response:", error);
    } finally {
      setIsSendingResponse(false);
    }
  };

  // バックエンドの実行を停止する
  const handleStopExecution = useCallback(async () => {
    // 即座にUIをキャンセル状態に更新（ユーザーに素早くフィードバックを提供）
    setPollingCancelled();

    // 親コンポーネントの状態も更新
    if (onStopExecution) {
      onStopExecution();
    }

    try {
      const API_BASE_URL =
        process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

      // タスクレベルの停止エンドポイントを使用（より確実）
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        {
          method: "POST",
        },
      );

      if (!res.ok) {
        // 失敗した場合はセッションレベルで試す（フォールバック）
        if (sessionId) {
          const fallbackRes = await fetch(
            `${API_BASE_URL}/agents/sessions/${sessionId}/stop`,
            {
              method: "POST",
            },
          );
          if (!fallbackRes.ok) {
            console.error("Failed to stop execution");
          }
        }
      }
    } catch (error) {
      console.error("Error stopping execution:", error);
    }
  }, [taskId, sessionId, setPollingCancelled, onStopExecution]);

  const handleReset = () => {
    stopPolling();
    clearLogs();
    setSessionId(null); // SSE接続をリセット
    hasRestoredRef.current = false; // 次回マウント時に復元を試みる
    onReset();
  };

  // 実行中または完了後（ログあり）
  const showLogPanel =
    (isExecuting || isPollingRunning || isSseRunning || logs.length > 0) &&
    (executionStatus === "completed" ||
      isExecuting ||
      pollingStatus === "running" ||
      sseStatus === "running" ||
      isWaitingForInput);

  // 実行完了後のステータス判定（SSEの状態も考慮）
  const finalStatus =
    sseStatus !== "idle"
      ? sseStatus
      : pollingStatus !== "idle"
        ? pollingStatus
        : executionStatus;
  // waiting_for_inputの場合は完了とは見なさない
  const isCompleted =
    finalStatus === "completed" &&
    !isPollingRunning &&
    !isSseRunning &&
    !isWaitingForInput;
  const isCancelled = finalStatus === "cancelled";
  const isFailed =
    finalStatus === "failed" || error || pollingError || sseError;
  // waiting_for_inputの場合も実行中として扱う（応答入力を待っている）
  const isRunning =
    isExecuting ||
    isPollingRunning ||
    isSseRunning ||
    pollingStatus === "running" ||
    sseStatus === "running" ||
    isWaitingForInput;

  // ExecutionLogViewer用のステータスを計算
  const logViewerStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return "running";
    if (isCancelled) return "cancelled";
    if (isCompleted) return "completed";
    if (isFailed) return "failed";
    return "idle";
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  // ログ表示切り替えのトグル関数
  const toggleShowLogsExternal = useCallback(() => {
    setShowLogsExternal((prev) => !prev);
  }, []);

  // 外部ログビューアコンポーネント（独立表示用）
  const externalLogViewer = showLogsExternal && logs.length > 0 && (
    <div className="mt-4">
      <ExecutionLogViewer
        logs={logs}
        status={logViewerStatus}
        isConnected={isSseConnected}
        isRunning={isRunning}
        collapsible={true}
        showHeader={true}
        maxHeight={400}
      />
    </div>
  );

  // 実行中の表示
  if (isRunning) {
    const showWaitingUI = isWaitingForInput && hasQuestion;

    return (
      <>
        <div
          className={`rounded-xl border overflow-hidden ${
            showWaitingUI
              ? "bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800"
              : "bg-linear-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800"
          }`}
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
                    showWaitingUI
                      ? "bg-amber-100 dark:bg-amber-900/40"
                      : "bg-blue-100 dark:bg-blue-900/40"
                  }`}
                >
                  {showWaitingUI ? (
                    <HelpCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Rocket className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                {!showWaitingUI && (
                  <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center shadow-lg">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                    {showWaitingUI
                      ? "Claude Codeからの質問"
                      : "AI エージェント実行中"}
                  </h3>
                  {/* 質問検出の信頼性バッジ */}
                  {showWaitingUI && isConfirmedQuestion && (
                    <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium">
                      ツール呼び出し
                    </span>
                  )}
                  {showWaitingUI && !isConfirmedQuestion && (
                    <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full font-medium">
                      パターン検出
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {showWaitingUI
                    ? "以下の質問に回答してください。回答後、実行が継続されます。"
                    : "Claude Codeがタスクの実装を進めています..."}
                </p>
                {/* {workingDirectory && (
                <div
                  className={`mt-2 flex items-center gap-2 text-xs ${
                    showWaitingUI
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-blue-700 dark:text-blue-300"
                  }`}
                >
                  <FolderOpen className="w-3 h-3" />
                  <span className="font-mono">{workingDirectory}</span>
                </div>
              )} */}
              </div>
            </div>
            {!showWaitingUI && (
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleStopExecution}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors"
                >
                  <Square className="w-4 h-4" />
                  停止
                </button>
              </div>
            )}
          </div>

          {/* 質問検出時の応答入力 */}
          {hasQuestion && (
            <div
              className={`mx-6 mb-4 p-4 rounded-lg ${
                showWaitingUI
                  ? "bg-white/60 dark:bg-zinc-900/40 border border-amber-200 dark:border-amber-700"
                  : "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
              }`}
            >
              {!showWaitingUI && (
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-1.5 bg-amber-100 dark:bg-amber-900/40 rounded-lg shrink-0">
                    <HelpCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <h4 className="font-medium text-amber-800 dark:text-amber-200 text-sm">
                      Claude Codeからの質問
                    </h4>
                    {/* 質問検出の信頼性バッジ */}
                    {isConfirmedQuestion && (
                      <span className="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                        確認済み
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div
                className={`mb-3 p-3 rounded-lg ${
                  showWaitingUI
                    ? "bg-amber-50 dark:bg-amber-900/30"
                    : "bg-white/60 dark:bg-zinc-800/60"
                }`}
              >
                <p className="text-sm text-amber-800 dark:text-amber-200 font-mono whitespace-pre-wrap">
                  {question}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={userResponse}
                  onChange={(e) => setUserResponse(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendResponse()}
                  placeholder="回答を入力してEnterで送信..."
                  className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  autoFocus={showWaitingUI}
                />
                <button
                  onClick={handleSendResponse}
                  disabled={!userResponse.trim() || isSendingResponse}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSendingResponse ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  送信
                </button>
              </div>
            </div>
          )}

          {/* ログ表示切り替えボタン */}
          <div className="mx-6 mb-4 flex items-center gap-2">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                showLogs
                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              <Terminal className="w-4 h-4" />
              実行ログを表示
            </button>
          </div>

          {/* カード内にログを表示 */}
          {showLogs && logs.length > 0 && (
            <div className="mx-6 mb-4">
              <ExecutionLogViewer
                logs={logs}
                status={logViewerStatus}
                isConnected={isSseConnected}
                isRunning={isRunning}
                collapsible={false}
                maxHeight={256}
              />
            </div>
          )}
        </div>
        {/* 独立表示のログビューア */}
        {externalLogViewer}
      </>
    );
  }

  // 実行完了（成功）
  if (isCompleted && executionResult?.success) {
    return (
      <>
        <div className="bg-linear-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                  実行完了
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  AIエージェントによる実装が完了しました。
                </p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-2">
                  承認ページでコードレビューを行い、変更をコミットしてください。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-3 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  リセット
                </button>
                <a
                  href="/approvals"
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  承認ページへ
                </a>
              </div>
            </div>
          </div>

          {/* ログ表示オプション */}
          {logs.length > 0 && (
            <div className="px-6 py-3 bg-emerald-100/50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    showLogs
                      ? "bg-emerald-200 dark:bg-emerald-800/60 text-emerald-800 dark:text-emerald-200"
                      : "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                  カード内に表示
                  {showLogs ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={toggleShowLogsExternal}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    showLogsExternal
                      ? "bg-emerald-200 dark:bg-emerald-800/60 text-emerald-800 dark:text-emerald-200"
                      : "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  独立表示
                </button>
              </div>
              {showLogs && (
                <ExecutionLogViewer
                  logs={logs}
                  status={logViewerStatus}
                  isConnected={isSseConnected}
                  isRunning={false}
                  collapsible={false}
                  maxHeight={256}
                />
              )}
            </div>
          )}
        </div>
        {/* 独立表示のログビューア */}
        {externalLogViewer}
      </>
    );
  }

  // 実行停止（キャンセル）
  if (isCancelled) {
    return (
      <>
        <div className="bg-linear-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 rounded-xl border border-yellow-200 dark:border-yellow-800 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-yellow-100 dark:bg-yellow-900/40 rounded-xl">
                <Square className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                  実行を停止しました
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  AIエージェントの実行が停止されました。
                </p>
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                再実行
              </button>
            </div>
          </div>

          {/* 停止時もログを表示 */}
          {logs.length > 0 && (
            <div className="px-6 py-3 bg-yellow-100/50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    showLogs
                      ? "bg-yellow-200 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200"
                      : "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                  カード内に表示
                  {showLogs ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={toggleShowLogsExternal}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    showLogsExternal
                      ? "bg-yellow-200 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200"
                      : "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  独立表示
                </button>
              </div>
              {showLogs && (
                <ExecutionLogViewer
                  logs={logs}
                  status={logViewerStatus}
                  isConnected={isSseConnected}
                  isRunning={false}
                  collapsible={false}
                  maxHeight={256}
                />
              )}
            </div>
          )}
        </div>
        {/* 独立表示のログビューア */}
        {externalLogViewer}
      </>
    );
  }

  // 実行失敗
  if (isFailed) {
    return (
      <>
        <div className="bg-linear-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 rounded-xl border border-red-200 dark:border-red-800 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-100 dark:bg-red-900/40 rounded-xl">
                <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-red-700 dark:text-red-300">
                  実行に失敗しました
                </h3>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {error ||
                    pollingError ||
                    executionResult?.error ||
                    "不明なエラーが発生しました"}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                再試行
              </button>
            </div>
          </div>

          {/* エラー時もログを表示 */}
          {logs.length > 0 && (
            <div className="px-6 py-3 bg-red-100/50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    showLogs
                      ? "bg-red-200 dark:bg-red-800/60 text-red-800 dark:text-red-200"
                      : "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                  カード内に表示
                  {showLogs ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={toggleShowLogsExternal}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    showLogsExternal
                      ? "bg-red-200 dark:bg-red-800/60 text-red-800 dark:text-red-200"
                      : "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  独立表示
                </button>
              </div>
              {showLogs && (
                <ExecutionLogViewer
                  logs={logs}
                  status={logViewerStatus}
                  isConnected={isSseConnected}
                  isRunning={false}
                  collapsible={false}
                  maxHeight={256}
                />
              )}
            </div>
          )}
        </div>
        {/* 独立表示のログビューア */}
        {externalLogViewer}
      </>
    );
  }

  // 初期状態（折りたたみ可能な展開メニュー）
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* ヘッダー（クリックで展開/折りたたみ） */}
      <div
        className="px-4 py-3 bg-linear-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border-b border-zinc-200 dark:border-zinc-700 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              AI エージェント実行
            </span>
            {optimizedPrompt && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs">
                <Sparkles className="w-3 h-3" />
                最適化済み
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 展開していない時でも実行ボタンを表示 */}
            {!isExpanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleExecute();
                }}
                disabled={isExecuting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            )}
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            )}
          </div>
        </div>
      </div>

      {/* 展開時のコンテンツ */}
      {isExpanded && (
        <>
          {/* メインセクション */}
          <div className="p-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Claude
              Codeがこのタスクを自動で実装します。完了後、差分をレビューしてコミット・PRを作成できます。
            </p>

            {/* 最適化プロンプト使用インジケータ */}
            {optimizedPrompt && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 mb-4">
                <Sparkles className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-700 dark:text-green-300">
                  最適化されたプロンプトを使用して実行します
                </span>
              </div>
            )}

            {/* 詳細オプション（折りたたみ） */}
            <button
              onClick={() => setShowOptions(!showOptions)}
              className="w-full px-3 py-2 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors mb-4"
            >
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                詳細オプション
              </span>
              {showOptions ? (
                <ChevronUp className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              )}
            </button>

            {/* 詳細オプション内容 */}
            {showOptions && (
              <div className="space-y-4 mb-4 p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
                {/* 追加指示 */}
                <div>
                  <label className="flex text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    追加の実装指示（任意）
                  </label>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例: TypeScriptの型を厳密に定義してください。テストも作成してください。"
                    rows={3}
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none"
                  />
                </div>

                {/* ブランチ名 */}
                <div>
                  <label className="flex text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 items-center gap-2">
                    <GitBranch className="w-4 h-4" />
                    作業ブランチ名（任意）
                  </label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder={`例: feature/task-${Date.now()}`}
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  />
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    指定しない場合、自動でフィーチャーブランチが作成されます
                  </p>
                </div>
              </div>
            )}

            {/* 実行ボタン */}
            <div className="mx-auto flex justify-center gap-2 max-w-4xl">
              <button
                onClick={handleExecute}
                disabled={isExecuting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Play className="w-4 h-4" />
                実行開始
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
  Settings,
  Clock,
  MessageSquarePlus,
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
import { API_BASE_URL } from "@/utils/api";

type Props = {
  taskId: number;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  error: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean; // AIタスク刁E��を使用するぁE
  optimizedPrompt?: string | null; // 最適化されたプロンプト
  agentConfigId?: number | null;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  // 実行状態復允E��
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  // 実行停止時�Eコールバック�E�親コンポ�Eネント�E状態更新用�E�E
  onStopExecution?: () => void;
  // 実行完亁E��のコールバック�E�親コンポ�Eネント�E状態更新用�E�E
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
  agentConfigId,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
  onExecutionComplete,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [showLogsExternal, setShowLogsExternal] = useState(false); // 外部�E�独立）でログを表示するぁE
  const [instruction, setInstruction] = useState("");
  const [branchName, setBranchName] = useState("");
  const [userResponse, setUserResponse] = useState("");
  const [isSendingResponse, setIsSendingResponse] = useState(false);
  const [followUpInstruction, setFollowUpInstruction] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const hasRestoredRef = useRef(false);
  // 質問タイムアウト�Eカウントダウン�E�残り秒数�E�E
  const [timeoutCountdown, setTimeoutCountdown] = useState<number | null>(null);

  // SSEベ�Eスのリアルタイムログ取征E
  const {
    logs: sseLogs,
    status: sseStatus,
    isRunning: isSseRunning,
    isConnected: isSseConnected,
    error: sseError,
    clearLogs: clearSseLogs,
  } = useExecutionStream(sessionId);

  // ポ�Eリングベ�Eスのログ取得（フォールバック�E�E��チE�Eタス確認用�E�E
  const {
    logs: pollingLogs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    questionType: pollingQuestionType,
    questionTimeout: pollingQuestionTimeout,
    startPolling,
    stopPolling,
    clearLogs: clearPollingLogs,
    setCancelled: setPollingCancelled,
    clearQuestion: clearPollingQuestion,
  } = useExecutionPolling(taskId);

  // SSEが接続されてぁE��場合�ESSEのログを優先、そぁE��なければポ�Eリングのログを使用
  // logs配�Eの参�Eを安定化させるためにuseMemoを使用
  const logs = useMemo(() => {
    return isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs;
  }, [isSseConnected, sseLogs, pollingLogs]);

  const clearLogs = useCallback(() => {
    clearSseLogs();
    clearPollingLogs();
  }, [clearSseLogs, clearPollingLogs]);

  // 質問�E検�E方法タイプ！Eattern_matchは廁E��、AIエージェントから�E明確なスチE�Eタスのみを信頼�E�E
  type QuestionType = "tool_call" | "none";

  // 質問検�E: APIからの状態�Eみを使用�E�パターンマッチングは廁E���E�E
  // AIエージェントがAskUserQuestionチE�Eルを呼び出した場合�Eみ質問として認譁E
  const detectQuestion = (): {
    hasQuestion: boolean;
    question: string;
    questionType: QuestionType;
  } => {
    // APIから質問征E��状態が返されてぁE��場合�Eみ質問として認譁E
    // pollingWaitingForInputはDBのstatus === "waiting_for_input"を反映
    // pollingQuestionTypeはAIエージェントから�EAskUserQuestionチE�Eル呼び出しを反映
    if (pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        // tool_callの場合�Eみ質問として認識、それ以外�Enone
        questionType:
          pollingQuestionType === "tool_call" ? "tool_call" : "none",
      };
    }

    // APIから質問状態が返されてぁE��ぁE��合�E質問なぁE
    // パターンマッチングによるフォールバックは削除
    return { hasQuestion: false, question: "", questionType: "none" };
  };

  const currentLogText = useMemo(() => logs.join(""), [logs]);

  // 質問検�Eの結果をメモ化！EPIからのスチE�Eタスのみを使用�E�E
  const { hasQuestion, question, questionType } = useMemo(() => {
    return detectQuestion();
  }, [pollingWaitingForInput, pollingQuestion, pollingQuestionType]);

  // questionTypeがtool_callの場合�Eより確実に質問があることを示ぁE
  const isConfirmedQuestion = questionType === "tool_call";

  // waiting_for_input状態�E判宁E
  // APIからのスチE�Eタスのみを信頼�E�パターンマッチングは廁E���E�E
  // pollingStatus === "waiting_for_input" はDBのstatusを反映
  // pollingWaitingForInput はAPI応答�EwaitingForInputフラグを反映
  const isTerminalStatus =
    pollingStatus === "completed" ||
    pollingStatus === "failed" ||
    pollingStatus === "cancelled" ||
    sseStatus === "completed" ||
    sseStatus === "failed" ||
    sseStatus === "cancelled";
  // AIエージェントから�E明確なスチE�Eタス�E�EBのstatus、APIのwaitingForInput�E��Eみを使用
  // hasQuestion�E�旧パターンマッチング結果�E��E判定に使用しなぁE
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === "waiting_for_input" || pollingWaitingForInput);

  // 質問タイムアウト�Eカウントダウン処琁E
  useEffect(() => {
    // 質問征E��状態でなぁE��合�Eカウントダウンをクリア
    if (!isWaitingForInput || !pollingQuestionTimeout) {
      setTimeoutCountdown(null);
      return;
    }

    // 初期値を設宁E
    setTimeoutCountdown(pollingQuestionTimeout.remainingSeconds);

    // 1秒ごとにカウントダウン
    const interval = setInterval(() => {
      setTimeoutCountdown((prev) => {
        if (prev === null || prev <= 0) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isWaitingForInput, pollingQuestionTimeout]);

  // カウントダウンの表示用フォーマッチE
  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // マウント時に実行状態を復允E
  useEffect(() => {
    const restoreState = async () => {
      // 既に復允E��み、また�E復允E��数がなぁE��合�EスキチE�E
      if (hasRestoredRef.current || !onRestoreExecutionState) {
        return;
      }
      // 既にsessionIdがある場合（新規実行中�E��EスキチE�E
      if (sessionId || executionResult?.sessionId) {
        return;
      }

      hasRestoredRef.current = true;
      setIsRestoring(true);

      try {
        const restoredState = await onRestoreExecutionState();
        if (restoredState) {
          setSessionId(restoredState.sessionId);
          // 復允E��は既存�E出力を初期値として渡ぁE
          startPolling({
            initialOutput: restoredState.output,
            preserveLogs: false,
          });
          setShowLogs(true);
        }
      } catch (err) {
        // 復允E��敗時は静かに失敁E
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, [onRestoreExecutionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // 実行開始時にSSE接続とポ�Eリングを開姁E
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;

  useEffect(() => {
    if (executionSessionId) {
      // SSE接続用にsessionIdを設宁E
      setSessionId(executionSessionId);
      // ポ�Eリングも開始（フォールバック用�E�E
      // 復允E��れた実行�E場合�E初期出力を渡ぁE
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

  // 実行中になったらポ�Eリング開姁E
  useEffect(() => {
    if (isExecuting && !isPollingRunning) {
      startPolling();
    }
  }, [isExecuting, isPollingRunning, startPolling]);

  // ポ�EリングのスチE�Eタスが完亁E失敁Eキャンセルになったら親コンポ�Eネントを更新
  useEffect(() => {
    if (
      pollingStatus === "completed" ||
      pollingStatus === "failed" ||
      pollingStatus === "cancelled"
    ) {
      // 親コンポ�Eネント�E状態を更新して実行完亁E��通知
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
      useTaskAnalysis, // AIタスク刁E��を使用するかどぁE��を渡ぁE
      optimizedPrompt: optimizedPrompt || undefined, // 最適化されたプロンプトを渡ぁE
      agentConfigId: agentConfigId ?? undefined, // 選択されたエージェント設定IDを渡ぁE
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  // 追加持E��で再実行
  const handleFollowUpExecute = async () => {
    const trimmedInstruction = followUpInstruction.trim();
    if (!trimmedInstruction) return;

    clearLogs();
    setFollowUpInstruction("");
    const result = await onExecute({
      instruction: trimmedInstruction,
      agentConfigId: agentConfigId ?? undefined,
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  // 送信中のリクエスチEDを追跡�E�重褁E��信防止�E�E
  const sendingResponseRef = useRef(false);

  const handleSendResponse = async () => {
    const trimmedResponse = userResponse.trim();
    if (!trimmedResponse || isSendingResponse || sendingResponseRef.current) return;

    // 即座にrefをセチE��して重褁E��信を防止
    sendingResponseRef.current = true;
    setIsSendingResponse(true);

    // 送信前に質問UIを非表示にする�E�楽観的UI更新�E�E
    clearPollingQuestion();
    const savedResponse = trimmedResponse;
    setUserResponse("");

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/agent-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: savedResponse }),
      });

      if (!res.ok) {
        // エラー時�E質問を復允E��ユーザーが�E試行できるように�E�E
        console.error("Failed to send response:", res.status);
        setUserResponse(savedResponse);
      }
    } catch (error) {
      console.error("Error sending response:", error);
      // エラー時�E回答を復允E
      setUserResponse(savedResponse);
    } finally {
      setIsSendingResponse(false);
      sendingResponseRef.current = false;
    }
  };

  // バックエンド�E実行を停止する
  const handleStopExecution = useCallback(async () => {
    // 即座にUIをキャンセル状態に更新�E�ユーザーに素早くフィードバチE��を提供！E
    setPollingCancelled();

    // ローカルのログもクリア�E�バチE��エンドでも削除されるため同期！E
    clearLogs();

    // 親コンポ�Eネント�E状態も更新
    if (onStopExecution) {
      onStopExecution();
    }

    try {
      // タスクレベルの停止エンド�Eイントを使用�E�より確実！E
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        {
          method: "POST",
        },
      );

      if (!res.ok) {
        // 失敗した場合�EセチE��ョンレベルで試す（フォールバック�E�E
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
  }, [taskId, sessionId, setPollingCancelled, clearLogs, onStopExecution]);

  const handleReset = () => {
    stopPolling();
    clearLogs();
    setSessionId(null); // SSE接続をリセット
    hasRestoredRef.current = false; // 次回�Eウント時に復允E��試みめE
    onReset();
  };

  // 実行中また�E完亁E��（ログあり�E�E
  const showLogPanel =
    (isExecuting || isPollingRunning || isSseRunning || logs.length > 0) &&
    (executionStatus === "completed" ||
      isExecuting ||
      pollingStatus === "running" ||
      sseStatus === "running" ||
      isWaitingForInput);

  // 実行完亁E���EスチE�Eタス判定！ESEの状態も老E�E�E�E
  const finalStatus =
    sseStatus !== "idle"
      ? sseStatus
      : pollingStatus !== "idle"
        ? pollingStatus
        : executionStatus;
  // waiting_for_inputの場合�E完亁E��は見なさなぁE
  const isCompleted =
    finalStatus === "completed" &&
    !isPollingRunning &&
    !isSseRunning &&
    !isWaitingForInput;
  const isCancelled = finalStatus === "cancelled";
  const isFailed =
    finalStatus === "failed" || error || pollingError || sseError;
  // waiting_for_inputの場合も実行中として扱ぁE��応答�E力を征E��てぁE���E�E
  const isRunning =
    isExecuting ||
    isPollingRunning ||
    isSseRunning ||
    pollingStatus === "running" ||
    sseStatus === "running" ||
    isWaitingForInput;

  // ExecutionLogViewer用のスチE�Eタスを計箁E
  const logViewerStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return "running";
    if (isCancelled) return "cancelled";
    if (isCompleted) return "completed";
    if (isFailed) return "failed";
    return "idle";
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  // ログ表示刁E��替え�Eトグル関数
  const toggleShowLogsExternal = useCallback(() => {
    setShowLogsExternal((prev) => !prev);
  }, []);

  // 外部ログビューアコンポ�Eネント（独立表示用�E�E
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
                  <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-indigo-dark-900 flex items-center justify-center shadow-lg">
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
                    : "Claude Codeがタスクの実行を進めています..."}
                </p>
              </div>
            </div>
            {/* 停止ボタン - 質問表示時もヘッダーに常に表示 */}
            <div className="flex justify-end mt-4">
              <button
                onClick={handleStopExecution}
                className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-700 dark:text-red-300 rounded-lg font-medium transition-colors"
              >
                <Square className="w-4 h-4" />
                停止
              </button>
            </div>
          </div>

          {/* 質問検�E時�E応答�E劁E*/}
          {hasQuestion && (
            <div
              className={`mx-6 mb-4 p-4 rounded-lg ${
                showWaitingUI
                  ? "bg-white/60 dark:bg-indigo-dark-900/40 border border-amber-200 dark:border-amber-700"
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
              {/* タイムアウトカウントダウン表示 */}
              {timeoutCountdown !== null && timeoutCountdown > 0 && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
                  <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm text-blue-700 dark:text-blue-300">
                    回答がない場合、
                    <span className="font-mono font-medium">
                      {formatCountdown(timeoutCountdown)}
                    </span>{" "}
                    後に自動的に続行します。
                  </span>
                </div>
              )}
              {/* タイムアウト直前の警告表示 */}
              {timeoutCountdown !== null &&
                timeoutCountdown > 0 &&
                timeoutCountdown <= 30 && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg animate-pulse">
                    <AlertCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    <span className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                      まもなく自動的に続行します。
                    </span>
                  </div>
                )}
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

          {/* ログ表示刁E��替え�Eタン */}
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

          {/* カード�Eにログを表示 */}
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

  // 実行完亁E���E功！E
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
                  AIエージェントによる実行が完了しました。
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

          {/* 追加持E��入力欁E*/}
          <div className="px-6 py-4 border-t border-emerald-200 dark:border-emerald-800 bg-white/50 dark:bg-indigo-dark-900/30">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquarePlus className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                追加の指示を送る
              </span>
            </div>
            <div className="flex items-start gap-2">
              <textarea
                value={followUpInstruction}
                onChange={(e) => setFollowUpInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    handleFollowUpExecute();
                  }
                }}
                placeholder="追加の修正や変更の指示を入力してください..."
                rows={2}
                className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none"
              />
              <button
                onClick={handleFollowUpExecute}
                disabled={!followUpInstruction.trim() || isExecuting}
                className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Ctrl+Enter で実行
            </p>
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

  // 実行キャンセル
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
                  実行をキャンセルしました
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  AIエージェントの実行がキャンセルされ、変更が元に戻されました。
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
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors border border-zinc-300 dark:border-zinc-600"
                >
                  <RefreshCw className="w-4 h-4" />
                  リセット
                </button>
                <button
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  再実行
                </button>
              </div>
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

  // 初期状態（折りたたみ可能な展開メニュー�E�E
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* ヘッダー�E�クリチE��で展開/折りたたみ�E�E*/}
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
            {/* 展開してぁE��ぁE��でも実行�Eタンを表示 */}
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

      {/* 展開時�EコンチE��チE*/}
      {isExpanded && (
        <>
          {/* メインセクション */}
          <div className="p-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Claude
              Codeがこのタスクを自動で実行します。完了後、差分をレビューしてコミットやPRを作成できます。
            </p>

            {/* 最適化�Eロンプト使用インジケータ */}
            {optimizedPrompt && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 mb-4">
                <Sparkles className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-700 dark:text-green-300">
                  最適化されたプロンプトを使用して実行します。
                </span>
              </div>
            )}

            {/* 詳細オプションと実行�Eタンを同じ行に配置 */}
            <div className="flex items-center gap-3">
              {/* 詳細オプション�E�アコーチE��オン形式！E*/}
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="flex-1 h-11 flex items-center justify-between px-4 bg-zinc-50 dark:bg-indigo-dark-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    詳細オプション
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
                    showOptions ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* 実行�Eタン */}
              <button
                onClick={handleExecute}
                disabled={isExecuting}
                className="h-11 flex items-center gap-2 px-6 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            </div>

            {/* 詳細オプション冁E�� */}
            {showOptions && (
              <div className="mt-3 space-y-4 p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700 animate-in slide-in-from-top-1 duration-200">
                {/* 追加持E�� */}
                <div>
                  <label className="flex text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    追加の実行指示（任意）
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
                    placeholder={`侁E feature/task-${Date.now()}`}
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  />
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    指定しない場合、自動でフィーチャーブランチが作成されます。
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

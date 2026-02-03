"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Rocket,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Play,
  Wand2,
  Settings,
  List,
  Copy,
  Check,
  Send,
  HelpCircle,
  Square,
  RefreshCw,
  Terminal,
  ExternalLink,
  GitBranch,
  ListTodo,
  FileText,
} from "lucide-react";
import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  Resource,
} from "@/types";
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

// TaskAnalysisResult is imported from @/types

type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category:
    | "scope"
    | "technical"
    | "requirements"
    | "constraints"
    | "integration"
    | "testing"
    | "deliverables";
};

type PromptResult = {
  optimizedPrompt: string;
  promptQuality: { score: number };
  hasQuestions: boolean;
  clarificationQuestions?: PromptClarificationQuestion[];
};

type Props = {
  taskId: number;
  taskTitle: string;
  taskDescription?: string | null;
  // AIAnalysisPanel props
  config: DeveloperModeConfig | null;
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  analysisError: string | null;
  analysisApprovalId: number | null;
  onAnalyze: () => Promise<void>;
  onApprove: (approvalId: number) => Promise<void>;
  onReject: (approvalId: number, reason: string) => Promise<void>;
  onApproveSubtasks: (selectedIndices?: number[]) => Promise<unknown>;
  isApproving: boolean;
  onOpenSettings: () => void;
  onPromptGenerated?: (prompt: string) => void;
  onSubtasksCreated?: () => void;
  // AgentExecutionPanel props
  showAgentPanel: boolean;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  executionError: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string | null;
  resources?: Resource[];
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    attachments?: Array<{
      id: number;
      title: string;
      type: string;
      fileName?: string;
      filePath?: string;
      mimeType?: string;
      description?: string;
    }>;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  onStopExecution?: () => void;
};

type AccordionSection = "analysis" | "execution";
type AnalysisTabType = "subtasks" | "prompt";

export function AIAccordionPanel({
  taskId,
  taskTitle,
  taskDescription,
  // AIAnalysisPanel props
  config,
  isAnalyzing,
  analysisResult,
  analysisError,
  analysisApprovalId,
  onAnalyze,
  onApprove,
  onReject,
  onApproveSubtasks,
  isApproving,
  onOpenSettings,
  onPromptGenerated,
  onSubtasksCreated,
  // AgentExecutionPanel props
  showAgentPanel,
  isExecuting,
  executionStatus,
  executionResult,
  executionError,
  useTaskAnalysis,
  optimizedPrompt,
  resources,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
}: Props) {
  const [expandedSection, setExpandedSection] =
    useState<AccordionSection | null>(null);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTabType>("subtasks");

  // 分析パネルの状態
  const [selectedSubtasks, setSelectedSubtasks] = useState<number[]>([]);
  const [isCreatingSubtasks, setIsCreatingSubtasks] = useState(false);
  const [subtaskCreationSuccess, setSubtaskCreationSuccess] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptResult, setPromptResult] = useState<PromptResult | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<
    Record<string, string>
  >({});
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);

  // 実行パネルの状態
  const [showLogs, setShowLogs] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [branchName, setBranchName] = useState("");
  const [isGeneratingBranchName, setIsGeneratingBranchName] = useState(false);
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

  // ポーリングベースのログ取得
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
    clearQuestion: clearPollingQuestion,
  } = useExecutionPolling(taskId);

  const logs = useMemo(() => {
    return isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs;
  }, [isSseConnected, sseLogs, pollingLogs]);

  const clearLogs = useCallback(() => {
    clearSseLogs();
    clearPollingLogs();
  }, [clearSseLogs, clearPollingLogs]);

  const toggleSection = (section: AccordionSection) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  // プロンプト生成
  const generatePrompt = useCallback(
    async (clarificationAnswers?: Record<string, string>) => {
      setIsGeneratingPrompt(true);
      setPromptError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/developer-mode/optimize-prompt/${taskId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clarificationAnswers }),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "プロンプト生成に失敗しました");
        }

        const data: PromptResult = await response.json();
        setPromptResult(data);

        if (!data.hasQuestions && onPromptGenerated) {
          onPromptGenerated(data.optimizedPrompt);
        }
      } catch (err) {
        setPromptError(
          err instanceof Error ? err.message : "エラーが発生しました",
        );
      } finally {
        setIsGeneratingPrompt(false);
      }
    },
    [taskId, onPromptGenerated],
  );

  // 質問への回答を送信
  const handleSubmitAnswers = useCallback(async () => {
    if (!promptResult?.clarificationQuestions) return;

    // 必須質問の回答チェック
    const requiredQuestions = promptResult.clarificationQuestions.filter(
      (q) => q.isRequired,
    );
    const unansweredRequired = requiredQuestions.filter(
      (q) => !questionAnswers[q.id]?.trim(),
    );
    if (unansweredRequired.length > 0) {
      setPromptError("必須の質問に回答してください");
      return;
    }

    setIsSubmittingAnswers(true);
    setPromptError(null);

    // 質問IDをキーにした回答を質問テキストをキーにした回答に変換
    const clarificationAnswers: Record<string, string> = {};
    promptResult.clarificationQuestions.forEach((q) => {
      if (questionAnswers[q.id]) {
        clarificationAnswers[q.question] = questionAnswers[q.id];
      }
    });

    try {
      await generatePrompt(clarificationAnswers);
      setQuestionAnswers({});
    } finally {
      setIsSubmittingAnswers(false);
    }
  }, [promptResult, questionAnswers, generatePrompt]);

  // カテゴリラベル取得
  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      scope: "スコープ",
      technical: "技術",
      requirements: "要件",
      constraints: "制約",
      integration: "統合",
      testing: "テスト",
      deliverables: "成果物",
    };
    return labels[category] || category;
  };

  const handleCopyPrompt = useCallback(() => {
    if (promptResult?.optimizedPrompt) {
      navigator.clipboard.writeText(promptResult.optimizedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [promptResult]);

  const handleUsePrompt = useCallback(() => {
    if (promptResult?.optimizedPrompt && onPromptGenerated) {
      onPromptGenerated(promptResult.optimizedPrompt);
    }
  }, [promptResult, onPromptGenerated]);

  // マウント時に実行状態を復元
  useEffect(() => {
    const restoreState = async () => {
      if (hasRestoredRef.current || !onRestoreExecutionState) return;
      if (sessionId || executionResult?.sessionId) return;

      hasRestoredRef.current = true;
      setIsRestoring(true);

      try {
        const restoredState = await onRestoreExecutionState();
        if (restoredState) {
          setSessionId(restoredState.sessionId);
          startPolling({
            initialOutput: restoredState.output,
            preserveLogs: false,
          });
          setShowLogs(true);
          setExpandedSection("execution");
        }
      } catch (err) {
        // 復元失敗
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, [onRestoreExecutionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // 実行開始時
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;

  useEffect(() => {
    if (executionSessionId) {
      setSessionId(executionSessionId);
      if (executionOutput) {
        startPolling({
          initialOutput: executionOutput,
          preserveLogs: false,
        });
      } else {
        startPolling();
      }
      setExpandedSection("execution");
    }
  }, [executionSessionId, executionOutput, startPolling]);

  useEffect(() => {
    if (isExecuting && !isPollingRunning) {
      startPolling();
    }
  }, [isExecuting, isPollingRunning, startPolling]);

  // ポーリングのステータスが完了/失敗/キャンセルになったら親コンポーネントを更新
  // ただし、キャンセルは handleStopExecution で既に処理されているため、completed と failed のみ処理
  useEffect(() => {
    if (pollingStatus === "completed" || pollingStatus === "failed") {
      // 親コンポーネントの状態を更新して実行完了を通知
      if (onStopExecution) {
        onStopExecution();
      }
    }
  }, [pollingStatus, onStopExecution]);

  const handleExecute = async () => {
    clearLogs();
    // ファイルリソースを添付情報として送信
    const fileResources = resources?.filter(
      (r) =>
        r.filePath ||
        r.type === "file" ||
        r.type === "image" ||
        r.type === "pdf",
    );
    const attachments = fileResources?.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      fileName: r.fileName || undefined,
      filePath: r.filePath || undefined,
      mimeType: r.mimeType || undefined,
      description: r.description || undefined,
    }));

    const result = await onExecute({
      instruction: instruction.trim() || undefined,
      branchName: branchName.trim() || undefined,
      useTaskAnalysis,
      optimizedPrompt: optimizedPrompt || undefined,
      attachments:
        attachments && attachments.length > 0 ? attachments : undefined,
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  const handleGenerateBranchName = async () => {
    if (isGeneratingBranchName) return;

    setIsGeneratingBranchName(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/generate-branch-name`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription || undefined,
          }),
        },
      );

      const data = await res.json();
      if (res.ok) {
        if (data.branchName) {
          setBranchName(data.branchName);
        }
      } else {
        console.error(
          "Failed to generate branch name:",
          data.error || data.details || "Unknown error",
        );
      }
    } catch (error) {
      console.error("Error generating branch name:", error);
    } finally {
      setIsGeneratingBranchName(false);
    }
  };

  // 送信中のリクエストIDを追跡（重複送信防止）
  const sendingResponseRef = useRef(false);

  const handleSendResponse = async () => {
    const trimmedResponse = userResponse.trim();
    if (!trimmedResponse || isSendingResponse || sendingResponseRef.current) return;

    // 即座にrefをセットして重複送信を防止
    sendingResponseRef.current = true;
    setIsSendingResponse(true);

    // 送信前に質問UIを非表示にする（楽観的UI更新）
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
        // エラー時は質問を復元（ユーザーが再試行できるように）
        console.error("Failed to send response:", res.status);
        setUserResponse(savedResponse);
      }
    } catch (error) {
      console.error("Error sending response:", error);
      // エラー時は回答を復元
      setUserResponse(savedResponse);
    } finally {
      setIsSendingResponse(false);
      sendingResponseRef.current = false;
    }
  };

  const handleStopExecution = useCallback(async () => {
    setPollingCancelled();
    if (onStopExecution) onStopExecution();

    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        { method: "POST" },
      );

      if (!res.ok && sessionId) {
        await fetch(`${API_BASE_URL}/agents/sessions/${sessionId}/stop`, {
          method: "POST",
        });
      }
    } catch (error) {
      console.error("Error stopping execution:", error);
    }
  }, [taskId, sessionId, setPollingCancelled, onStopExecution]);

  const handleReset = () => {
    stopPolling();
    clearLogs();
    setSessionId(null);
    hasRestoredRef.current = false;
    onReset();
  };

  // リセット後に実行を開始する
  const handleRerunExecution = async () => {
    handleReset();
    // リセット後に実行を開始
    await handleExecute();
  };

  // 質問検出（APIからのステータスのみを使用、パターンマッチングは廃止）
  // AIエージェントがAskUserQuestionツールを呼び出した場合のみ質問として認識
  const { hasQuestion, question, questionType } = useMemo(() => {
    // APIから質問待ち状態が返されている場合のみ質問として認識
    // pollingWaitingForInputはDBのstatus === "waiting_for_input"を反映
    // pollingQuestionTypeはAIエージェントからのAskUserQuestionツール呼び出しを反映
    if (pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        // tool_callの場合のみ質問として認識、それ以外はnone
        questionType:
          pollingQuestionType === "tool_call" ? "tool_call" : "none",
      };
    }

    // APIから質問状態が返されていない場合は質問なし
    // パターンマッチングによるフォールバックは削除
    return { hasQuestion: false, question: "", questionType: "none" as const };
  }, [pollingWaitingForInput, pollingQuestion, pollingQuestionType]);

  const isTerminalStatus =
    pollingStatus === "completed" ||
    pollingStatus === "failed" ||
    pollingStatus === "cancelled" ||
    sseStatus === "completed" ||
    sseStatus === "failed" ||
    sseStatus === "cancelled";
  // AIエージェントからの明確なステータス（DBのstatus、APIのwaitingForInput）のみを使用
  // hasQuestion（旧パターンマッチング結果）は判定に使用しない
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === "waiting_for_input" || pollingWaitingForInput);

  const finalStatus =
    sseStatus !== "idle"
      ? sseStatus
      : pollingStatus !== "idle"
        ? pollingStatus
        : executionStatus;
  // 完了判定: ステータスが完了であれば完了とみなす（ポーリング状態に依存しない）
  const isCompleted = finalStatus === "completed" && !isWaitingForInput;
  const isCancelled = finalStatus === "cancelled";
  const isFailed =
    finalStatus === "failed" || executionError || pollingError || sseError;
  // 実行中判定: 終了ステータスの場合は実行中ではない
  const isRunning =
    !isTerminalStatus &&
    (isExecuting ||
      isPollingRunning ||
      isSseRunning ||
      pollingStatus === "running" ||
      sseStatus === "running" ||
      isWaitingForInput);

  const logViewerStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return "running";
    if (isCancelled) return "cancelled";
    if (isCompleted) return "completed";
    if (isFailed) return "failed";
    return "idle";
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  // ステータス計算
  const getAnalysisStatus = () => {
    if (isAnalyzing || isGeneratingPrompt) return "loading";
    if (analysisError || promptError) return "error";
    if (analysisResult || promptResult) return "success";
    return "idle";
  };

  const getExecutionStatusIcon = () => {
    if (isRunning) return "loading";
    if (isFailed) return "error";
    if (isCompleted) return "success";
    if (isCancelled) return "cancelled";
    return "idle";
  };

  const analysisStatusIcon = getAnalysisStatus();
  const execStatusIcon = getExecutionStatusIcon();

  return (
    <div
      className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden"
      role="region"
      aria-label="AI アシスタントパネル"
    >
      {/* メインヘッダー */}
      <div className="px-4 py-3 bg-linear-to-r from-violet-50 via-indigo-50 to-purple-50 dark:from-violet-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
            <Bot className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-50">
              AI アシスタント
            </h2>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
              分析・最適化・自動実装
            </p>
          </div>
          {/* ステータスバッジ */}
          <div className="flex items-center gap-1.5">
            {optimizedPrompt && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-[10px] font-medium">
                <Sparkles className="w-2.5 h-2.5" />
                <span className="hidden sm:inline">最適化</span>
              </span>
            )}
            {analysisResult && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-[10px] font-medium">
                <CheckCircle2 className="w-2.5 h-2.5" />
                <span className="hidden sm:inline">分析完了</span>
              </span>
            )}
            {/* 設定ボタン */}
            <button
              onClick={onOpenSettings}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              aria-label="AI設定を開く"
              title="詳細設定"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* タスク分析・プロンプト最適化セクション */}
      <div className="border-b border-zinc-100 dark:border-zinc-800">
        <button
          onClick={() => toggleSection("analysis")}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          aria-expanded={expandedSection === "analysis"}
          aria-controls="analysis-section-content"
        >
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              タスク分析・最適化
            </span>
            {analysisStatusIcon === "loading" && (
              <Loader2 className="w-3 h-3 text-violet-500 animate-spin" />
            )}
            {analysisStatusIcon === "success" && (
              <CheckCircle2 className="w-3 h-3 text-green-500" />
            )}
            {analysisStatusIcon === "error" && (
              <AlertCircle className="w-3 h-3 text-red-500" />
            )}
          </div>
          {expandedSection === "analysis" ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </button>

        {expandedSection === "analysis" && (
          <div id="analysis-section-content" className="px-4 pb-3 space-y-3">
            {/* タブメニュー */}
            <div
              className="flex border-b border-zinc-200 dark:border-zinc-700"
              role="tablist"
            >
              <button
                role="tab"
                aria-selected={analysisTab === "subtasks"}
                aria-controls="subtasks-panel"
                onClick={() => setAnalysisTab("subtasks")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors ${
                  analysisTab === "subtasks"
                    ? "text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50/50 dark:bg-violet-900/10"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                <ListTodo className="w-3.5 h-3.5" />
                サブタスク
                {analysisResult?.suggestedSubtasks?.length ? (
                  <span className="px-1 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px]">
                    {analysisResult.suggestedSubtasks.length}
                  </span>
                ) : null}
              </button>
              <button
                role="tab"
                aria-selected={analysisTab === "prompt"}
                aria-controls="prompt-panel"
                onClick={() => setAnalysisTab("prompt")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors ${
                  analysisTab === "prompt"
                    ? "text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/10"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                プロンプト
                {promptResult && (
                  <span className="px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded text-[10px]">
                    ✓
                  </span>
                )}
              </button>
            </div>

            {/* サブタスクパネル */}
            {analysisTab === "subtasks" && (
              <div id="subtasks-panel" role="tabpanel" className="space-y-2">
                {isAnalyzing ? (
                  <div className="flex items-center gap-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      タスクを分析中...
                    </span>
                  </div>
                ) : analysisError ? (
                  <div className="flex items-center gap-2 p-2.5 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs text-red-600 dark:text-red-400">
                      {analysisError}
                    </span>
                  </div>
                ) : analysisResult ? (
                  <div className="space-y-2">
                    {/* 分析サマリー */}
                    <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2">
                        {analysisResult.summary}
                      </p>
                    </div>
                    {analysisResult.suggestedSubtasks?.length > 0 && (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                            提案サブタスク
                          </p>
                          {analysisApprovalId && !subtaskCreationSuccess && (
                            <button
                              onClick={() => {
                                const allIndices =
                                  analysisResult.suggestedSubtasks.map(
                                    (_, i) => i,
                                  );
                                setSelectedSubtasks(
                                  selectedSubtasks.length === allIndices.length
                                    ? []
                                    : allIndices,
                                );
                              }}
                              className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline"
                            >
                              {selectedSubtasks.length ===
                              analysisResult.suggestedSubtasks.length
                                ? "解除"
                                : "全選択"}
                            </button>
                          )}
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {analysisResult.suggestedSubtasks.map((st, i) => (
                            <div
                              key={i}
                              className={`p-1.5 rounded text-xs flex items-start gap-1.5 ${
                                analysisApprovalId && !subtaskCreationSuccess
                                  ? "bg-violet-50 dark:bg-violet-900/20 cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/30"
                                  : "bg-violet-50 dark:bg-violet-900/20"
                              }`}
                              onClick={() => {
                                if (
                                  analysisApprovalId &&
                                  !subtaskCreationSuccess
                                ) {
                                  setSelectedSubtasks((prev) =>
                                    prev.includes(i)
                                      ? prev.filter((idx) => idx !== i)
                                      : [...prev, i],
                                  );
                                }
                              }}
                            >
                              {analysisApprovalId &&
                                !subtaskCreationSuccess && (
                                  <input
                                    type="checkbox"
                                    checked={selectedSubtasks.includes(i)}
                                    onChange={() => {}}
                                    className="mt-0.5 w-3 h-3 rounded border-violet-300 text-violet-600"
                                    aria-label={`${st.title}を選択`}
                                  />
                                )}
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-violet-700 dark:text-violet-300 text-[11px] line-clamp-1">
                                  {st.title}
                                </span>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span
                                    className={`px-1 py-0.5 rounded text-[9px] ${
                                      st.priority === "high"
                                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                        : st.priority === "medium"
                                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                          : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                    }`}
                                  >
                                    {st.priority === "high"
                                      ? "高"
                                      : st.priority === "medium"
                                        ? "中"
                                        : "低"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {analysisApprovalId && !subtaskCreationSuccess && (
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <span className="text-[10px] text-zinc-500">
                              {selectedSubtasks.length}件選択
                            </span>
                            <button
                              onClick={async () => {
                                setIsCreatingSubtasks(true);
                                try {
                                  const result = await onApproveSubtasks(
                                    selectedSubtasks.length > 0
                                      ? selectedSubtasks
                                      : undefined,
                                  );
                                  if (result) {
                                    setSubtaskCreationSuccess(true);
                                    setSelectedSubtasks([]);
                                    onSubtasksCreated?.();
                                  }
                                } finally {
                                  setIsCreatingSubtasks(false);
                                }
                              }}
                              disabled={isCreatingSubtasks}
                              className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                            >
                              {isCreatingSubtasks ? (
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-2.5 h-2.5" />
                              )}
                              作成
                            </button>
                          </div>
                        )}
                        {subtaskCreationSuccess && (
                          <div className="flex items-center gap-1.5 p-1.5 bg-green-50 dark:bg-green-900/20 rounded text-[10px] text-green-700 dark:text-green-300">
                            <CheckCircle2 className="w-3 h-3" />
                            サブタスクを作成しました
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <BrainCircuit className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
                      AIがタスクを分析し、サブタスクを提案します
                    </p>
                    <button
                      onClick={onAnalyze}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded-lg transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      分析開始
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* プロンプトパネル */}
            {analysisTab === "prompt" && (
              <div id="prompt-panel" role="tabpanel" className="space-y-2">
                {isGeneratingPrompt ? (
                  <div className="flex items-center gap-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      最適化中...
                    </span>
                  </div>
                ) : promptError ? (
                  <div className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-[10px] text-red-600 dark:text-red-400 line-clamp-1">
                        {promptError}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setPromptError(null);
                        generatePrompt();
                      }}
                      className="text-[10px] text-red-600 hover:text-red-700 font-medium shrink-0"
                    >
                      再試行
                    </button>
                  </div>
                ) : promptResult?.hasQuestions &&
                  promptResult.clarificationQuestions &&
                  promptResult.clarificationQuestions.length > 0 ? (
                  /* 質問がある場合 */
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-medium">
                        追加情報が必要です
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
                      スコア: {promptResult.promptQuality.score}/100 -
                      より良いプロンプトを生成するために回答してください
                    </div>
                    <div className="space-y-2.5 max-h-48 overflow-y-auto">
                      {promptResult.clarificationQuestions.map((q) => (
                        <div key={q.id} className="space-y-1">
                          <div className="flex items-start gap-1.5">
                            <span className="text-[10px] text-zinc-700 dark:text-zinc-300 flex-1">
                              {q.question}
                              {q.isRequired && (
                                <span className="text-red-500 ml-0.5">*</span>
                              )}
                            </span>
                            <span className="text-[9px] px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded shrink-0">
                              {getCategoryLabel(q.category)}
                            </span>
                          </div>
                          {q.options && q.options.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {q.options.map((option, i) => (
                                <button
                                  key={i}
                                  onClick={() =>
                                    setQuestionAnswers((prev) => ({
                                      ...prev,
                                      [q.id]: option,
                                    }))
                                  }
                                  className={`px-2 py-0.5 text-[9px] rounded border transition-colors ${
                                    questionAnswers[q.id] === option
                                      ? "border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                                      : "border-zinc-200 dark:border-zinc-700 hover:border-amber-300"
                                  }`}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={questionAnswers[q.id] || ""}
                              onChange={(e) =>
                                setQuestionAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              placeholder="回答を入力..."
                              className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-1.5 pt-1">
                      <button
                        onClick={() => {
                          setPromptResult(null);
                          setQuestionAnswers({});
                        }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-700 px-2 py-1"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleSubmitAnswers}
                        disabled={isSubmittingAnswers}
                        className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                      >
                        {isSubmittingAnswers ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Send className="w-2.5 h-2.5" />
                        )}
                        回答を送信
                      </button>
                    </div>
                  </div>
                ) : promptResult ? (
                  /* 質問がない場合（通常の結果表示） */
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        <span className="text-[10px] text-zinc-700 dark:text-zinc-300">
                          スコア: {promptResult.promptQuality.score}/100
                        </span>
                      </div>
                      <button
                        onClick={handleCopyPrompt}
                        className="p-1 text-zinc-400 hover:text-zinc-600 rounded"
                        aria-label="プロンプトをコピー"
                      >
                        {copied ? (
                          <Check className="w-3 h-3 text-green-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-2 font-mono text-[10px] text-zinc-600 dark:text-zinc-400 max-h-20 overflow-y-auto whitespace-pre-wrap">
                      {promptResult.optimizedPrompt.length > 150
                        ? `${promptResult.optimizedPrompt.slice(0, 150)}...`
                        : promptResult.optimizedPrompt}
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => {
                          setPromptResult(null);
                          generatePrompt();
                        }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-700 px-2 py-1"
                      >
                        再生成
                      </button>
                      <button
                        onClick={handleUsePrompt}
                        className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-medium rounded transition-colors"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        使用
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Wand2 className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
                      タスク説明をAIエージェント向けに最適化
                    </p>
                    <button
                      onClick={() => generatePrompt()}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded-lg transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      プロンプト生成
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AIエージェント実行セクション */}
      {showAgentPanel && (
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection("execution")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSection("execution");
              }
            }}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
            aria-expanded={expandedSection === "execution"}
            aria-controls="execution-section-content"
          >
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                エージェント実行
              </span>
              {execStatusIcon === "loading" && (
                <Loader2 className="w-3 h-3 text-indigo-500 animate-spin" />
              )}
              {execStatusIcon === "success" && (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              )}
              {execStatusIcon === "error" && (
                <AlertCircle className="w-3 h-3 text-red-500" />
              )}
              {execStatusIcon === "cancelled" && (
                <span className="px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-[10px] rounded">
                  停止
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {/* 実行中: 停止ボタン */}
              {isRunning && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStopExecution();
                  }}
                  className="flex items-center gap-1 px-2 py-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium rounded transition-colors"
                  aria-label="実行を停止"
                >
                  <Square className="w-2.5 h-2.5" />
                  停止
                </button>
              )}
              {/* 完了: リセット、承認ページ */}
              {isCompleted && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    リセット
                  </button>
                  <a
                    href="/approvals?hideHeader=true"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded transition-colors"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    承認
                  </a>
                </>
              )}
              {/* キャンセル: 再実行 */}
              {isCancelled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRerunExecution();
                  }}
                  className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-[10px] font-medium rounded transition-colors"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  再実行
                </button>
              )}
              {/* エラー: リセット + 再試行 */}
              {isFailed && !isRunning && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    リセット
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRerunExecution();
                    }}
                    className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-medium rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    再試行
                  </button>
                </>
              )}
              {/* 初期状態: 実行開始 */}
              {!isRunning && !isCompleted && !isCancelled && !isFailed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExecute();
                  }}
                  disabled={isExecuting}
                  className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                  aria-label="実行開始"
                >
                  <Play className="w-2.5 h-2.5" />
                  実行
                </button>
              )}
              {expandedSection === "execution" ? (
                <ChevronUp className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              )}
            </div>
          </div>

          {expandedSection === "execution" && (
            <div id="execution-section-content" className="px-4 pb-3 space-y-3">
              {/* 実行中 */}
              {isRunning ? (
                <div className="space-y-2">
                  {/* 質問入力 */}
                  {hasQuestion && (
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                      <p className="text-[10px] text-amber-800 dark:text-amber-200 font-mono mb-1.5 whitespace-pre-wrap line-clamp-3">
                        {question.length > 150
                          ? `${question.slice(-150)}...`
                          : question}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={userResponse}
                          onChange={(e) => setUserResponse(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && handleSendResponse()
                          }
                          placeholder="回答を入力..."
                          className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded text-[10px]"
                          autoFocus
                          aria-label="エージェントへの回答"
                        />
                        <button
                          onClick={handleSendResponse}
                          disabled={!userResponse.trim() || isSendingResponse}
                          className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                          aria-label="回答を送信"
                        >
                          {isSendingResponse ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Send className="w-2.5 h-2.5" />
                          )}
                          送信
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ログ表示 */}
                  {logs.length > 0 && (
                    <div id="execution-logs">
                      <ExecutionLogViewer
                        logs={logs}
                        status={logViewerStatus}
                        isConnected={isSseConnected}
                        isRunning={isRunning}
                        collapsible={false}
                        maxHeight={150}
                      />
                    </div>
                  )}
                </div>
              ) : isCompleted ? (
                /* 完了 */
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs text-emerald-700 dark:text-emerald-300">
                      実行完了
                    </span>
                  </div>
                  {logs.length > 0 && showLogs && (
                    <ExecutionLogViewer
                      logs={logs}
                      status={logViewerStatus}
                      isConnected={isSseConnected}
                      isRunning={false}
                      collapsible={false}
                      maxHeight={150}
                    />
                  )}
                </div>
              ) : isCancelled ? (
                /* キャンセル */
                <div className="flex items-center gap-1.5 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <Square className="w-3.5 h-3.5 text-yellow-500" />
                  <span className="text-xs text-yellow-700 dark:text-yellow-300">
                    実行を停止しました
                  </span>
                </div>
              ) : isFailed ? (
                /* エラー */
                <div className="flex items-center gap-1.5 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-xs text-red-600 dark:text-red-400 line-clamp-2">
                    {executionError || pollingError || "エラーが発生しました"}
                  </span>
                </div>
              ) : (
                /* 初期状態 */
                <div className="space-y-2">
                  {optimizedPrompt && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                      <Sparkles className="w-2.5 h-2.5 text-green-600 dark:text-green-400" />
                      <span className="text-[10px] text-green-700 dark:text-green-300">
                        最適化プロンプト使用
                      </span>
                    </div>
                  )}

                  {/* 詳細オプション - 常時表示 */}
                  <div className="space-y-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
                    <div>
                      <label className="text-[10px] text-zinc-600 dark:text-zinc-400 mb-1 block">
                        追加指示
                      </label>
                      <textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="追加の実装指示..."
                        rows={2}
                        className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] resize-none"
                        aria-label="追加の実装指示"
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400 mb-1">
                        <GitBranch className="w-2.5 h-2.5" />
                        ブランチ名
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={branchName}
                          onChange={(e) => setBranchName(e.target.value)}
                          placeholder="feature/..."
                          className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono"
                          aria-label="ブランチ名"
                        />
                        <button
                          onClick={handleGenerateBranchName}
                          disabled={isGeneratingBranchName}
                          className="px-2 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px] hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-50 flex items-center gap-1"
                          title="AIでブランチ名を生成"
                        >
                          {isGeneratingBranchName ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Wand2 className="w-2.5 h-2.5" />
                          )}
                          <span>生成</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

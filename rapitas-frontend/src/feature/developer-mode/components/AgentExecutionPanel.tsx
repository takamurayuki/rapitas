"use client";

import { useState, useEffect, useRef } from "react";
import {
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Rocket,
  Code2,
  GitBranch,
  FolderOpen,
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Square,
  RefreshCw,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Send,
  HelpCircle,
} from "lucide-react";
import type {
  ExecutionStatus,
  ExecutionResult,
} from "../hooks/useDeveloperMode";
import { useExecutionPolling } from "../hooks/useExecutionStream";

type Props = {
  taskId: number;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  error: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
};

export function AgentExecutionPanel({
  taskId,
  isExecuting,
  executionStatus,
  executionResult,
  error,
  workingDirectory,
  defaultBranch,
  onExecute,
  onReset,
}: Props) {
  const [showOptions, setShowOptions] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [branchName, setBranchName] = useState("");
  const [copied, setCopied] = useState(false);
  const [userResponse, setUserResponse] = useState("");
  const [isSendingResponse, setIsSendingResponse] = useState(false);

  const logContainerRef = useRef<HTMLDivElement>(null);

  // ポーリングベースのログ取得
  const {
    logs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    startPolling,
    stopPolling,
    clearLogs,
  } = useExecutionPolling(taskId);

  // 質問検出: APIからの状態を優先、なければログから検出
  const detectQuestion = (
    logText: string,
  ): { hasQuestion: boolean; question: string } => {
    // APIから質問待ち状態が返されている場合はそれを使用
    if (pollingWaitingForInput && pollingQuestion) {
      return { hasQuestion: true, question: pollingQuestion };
    }

    if (!logText) return { hasQuestion: false, question: "" };

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
      };
    }

    return { hasQuestion: false, question: "" };
  };

  const currentLogText = logs.join("");
  const { hasQuestion, question } = detectQuestion(currentLogText);

  // waiting_for_input状態の場合は、完了とは見なさない
  const isWaitingForInput =
    pollingStatus === "waiting_for_input" ||
    pollingWaitingForInput ||
    hasQuestion;

  // 実行開始時にポーリングを開始
  useEffect(() => {
    console.log(
      "[AgentExecutionPanel] executionResult changed:",
      executionResult,
    );
    console.log("[AgentExecutionPanel] isExecuting:", isExecuting);
    if (executionResult?.sessionId) {
      console.log(
        "[AgentExecutionPanel] Starting polling for session:",
        executionResult.sessionId,
      );
      startPolling();
    }
  }, [executionResult, startPolling]);

  // 実行中になったらポーリング開始
  useEffect(() => {
    if (isExecuting && !isPollingRunning) {
      console.log("[AgentExecutionPanel] isExecuting=true, starting polling");
      startPolling();
    }
  }, [isExecuting, isPollingRunning, startPolling]);

  // ログが更新されたら自動スクロール
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleExecute = async () => {
    clearLogs();
    const result = await onExecute({
      instruction: instruction.trim() || undefined,
      branchName: branchName.trim() || undefined,
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join(""));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  const handleReset = () => {
    stopPolling();
    clearLogs();
    onReset();
  };

  // 実行中または完了後（ログあり）
  const showLogPanel =
    (isExecuting || isPollingRunning || logs.length > 0) &&
    (executionStatus === "completed" ||
      isExecuting ||
      pollingStatus === "running" ||
      isWaitingForInput);

  // 実行完了後のステータス判定
  const finalStatus =
    pollingStatus !== "idle" ? pollingStatus : executionStatus;
  // waiting_for_inputの場合は完了とは見なさない
  const isCompleted =
    finalStatus === "completed" && !isPollingRunning && !isWaitingForInput;
  const isFailed = finalStatus === "failed" || error || pollingError;
  // waiting_for_inputの場合も実行中として扱う（応答入力を待っている）
  const isRunning =
    isExecuting ||
    isPollingRunning ||
    pollingStatus === "running" ||
    isWaitingForInput;

  // ログビューアー
  const LogViewer = () => (
    <div
      className={`transition-all duration-300 ${
        isLogExpanded
          ? "fixed inset-4 z-50 bg-zinc-900 rounded-xl shadow-2xl"
          : "mt-4"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 rounded-t-lg border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-zinc-200">実行ログ</span>
          {isRunning && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              実行中
            </span>
          )}
          {isCompleted && !isRunning && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">
              <CheckCircle2 className="w-3 h-3" />
              完了
            </span>
          )}
          {isFailed && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
              <AlertCircle className="w-3 h-3" />
              エラー
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyLogs}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
            title="ログをコピー"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setIsLogExpanded(!isLogExpanded)}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
            title={isLogExpanded ? "縮小" : "拡大"}
          >
            {isLogExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      <div
        ref={logContainerRef}
        className={`bg-zinc-900 rounded-b-lg overflow-auto font-mono text-sm ${
          isLogExpanded ? "h-[calc(100%-3rem)]" : "h-64"
        }`}
      >
        <pre className="p-4 text-zinc-300 whitespace-pre-wrap wrap-break-words">
          {logs.length > 0 ? (
            logs.map((log, i) => (
              <span
                key={i}
                className={log.includes("[エラー]") ? "text-red-400" : ""}
              >
                {log}
              </span>
            ))
          ) : (
            <span className="text-zinc-500">ログを待機中...</span>
          )}
          {isRunning && (
            <span className="inline-flex w-2 h-4 bg-green-400 ml-1 animate-pulse" />
          )}
        </pre>
      </div>
    </div>
  );

  // 実行中の表示
  if (isRunning) {
    const showWaitingUI = isWaitingForInput && hasQuestion;

    return (
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
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                {showWaitingUI
                  ? "Claude Codeからの質問"
                  : "AI エージェント実行中"}
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                {showWaitingUI
                  ? "以下の質問に回答してください。回答後、実行が継続されます。"
                  : "Claude Codeがタスクの実装を進めています..."}
              </p>
              {workingDirectory && (
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
              )}
            </div>
            {!showWaitingUI && (
              <button
                onClick={stopPolling}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors"
              >
                <Square className="w-4 h-4" />
                停止
              </button>
            )}
          </div>
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
                <div className="flex-1">
                  <h4 className="font-medium text-amber-800 dark:text-amber-200 text-sm">
                    Claude Codeからの質問
                  </h4>
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

        {showLogs && <LogViewer />}
      </div>
    );
  }

  // 実行完了（成功）
  if (isCompleted && executionResult?.success) {
    return (
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

        {/* ログを折りたたみ表示 */}
        {logs.length > 0 && (
          <>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="w-full px-6 py-2 flex items-center justify-between bg-emerald-100/50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
            >
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                実行ログを表示
              </span>
              {showLogs ? (
                <ChevronUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              )}
            </button>
            {showLogs && <LogViewer />}
          </>
        )}
      </div>
    );
  }

  // 実行失敗
  if (isFailed) {
    return (
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
          <>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="w-full px-6 py-2 flex items-center justify-between bg-red-100/50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            >
              <span className="text-sm font-medium text-red-700 dark:text-red-300">
                実行ログを表示
              </span>
              {showLogs ? (
                <ChevronUp className="w-4 h-4 text-red-600 dark:text-red-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-red-600 dark:text-red-400" />
              )}
            </button>
            {showLogs && <LogViewer />}
          </>
        )}
      </div>
    );
  }

  // 初期状態（実行ボタン）
  return (
    <div className="bg-linear-to-r from-violet-50 via-purple-50 to-indigo-50 dark:from-violet-950/30 dark:via-purple-950/30 dark:to-indigo-950/30 rounded-xl border border-violet-200 dark:border-violet-800 overflow-hidden">
      {/* メインセクション */}
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-linear-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg">
            <Code2 className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-500" />
              AI エージェント実行
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              Claude
              Codeがこのタスクを自動で実装します。完了後、差分をレビューしてコミット・PRを作成できます。
            </p>
          </div>
          <button
            onClick={handleExecute}
            disabled={isExecuting}
            className="flex items-center gap-2 px-6 py-3 bg-linear-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <Play className="w-5 h-5" />
            実行開始
          </button>
        </div>

        {/* 作業ディレクトリ表示 */}
        {workingDirectory && (
          <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-zinc-900/40 rounded-lg">
            <FolderOpen className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
              {workingDirectory}
            </span>
          </div>
        )}
      </div>

      {/* オプション表示トグル */}
      <button
        onClick={() => setShowOptions(!showOptions)}
        className="w-full px-6 py-3 flex items-center justify-between bg-violet-100/50 dark:bg-violet-900/20 border-t border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
      >
        <span className="text-sm font-medium text-violet-700 dark:text-violet-300">
          詳細オプション
        </span>
        {showOptions ? (
          <ChevronUp className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        )}
      </button>

      {/* 詳細オプション */}
      {showOptions && (
        <div className="p-6 bg-white/40 dark:bg-zinc-900/20 border-t border-violet-200 dark:border-violet-800 space-y-4">
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
              className="w-full px-4 py-3 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none"
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
              className="w-full px-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              指定しない場合、自動でフィーチャーブランチが作成されます
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

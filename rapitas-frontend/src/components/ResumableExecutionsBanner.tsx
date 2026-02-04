"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertTriangle,
  Play,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Clock,
  Zap,
  RotateCcw,
} from "lucide-react";
import { API_BASE_URL } from "@/utils/api";

// セッション中に自動再開が実行済みかどうかを追跡するグローバルフラグ
const AUTO_RESUME_SESSION_KEY = "rapitas_auto_resume_triggered";

type ResumableExecution = {
  id: number;
  taskId: number;
  taskTitle: string;
  sessionId: number;
  status: string;
  claudeSessionId: string | null;
  errorMessage: string | null;
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  workingDirectory: string | null;
  canResume: boolean;
};

type ResumableExecutionsBannerProps = {
  autoResume?: boolean;
  onAutoResumeComplete?: () => void;
};

export function ResumableExecutionsBanner({
  autoResume = false,
  onAutoResumeComplete,
}: ResumableExecutionsBannerProps) {
  const [executions, setExecutions] = useState<ResumableExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [resumingIds, setResumingIds] = useState<Set<number>>(new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<number>>(new Set());

  // セッション中に一度だけ自動再開を実行するためのフラグ
  const autoResumeCheckedRef = useRef(false);

  // Fetch resumable executions on mount
  const fetchResumableExecutions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/resumable-executions`);
      if (res.ok) {
        const data = await res.json();
        setExecutions(data);
        return data;
      }
    } catch (error) {
      console.error("Failed to fetch resumable executions:", error);
    } finally {
      setIsLoading(false);
    }
    return [];
  }, []);

  useEffect(() => {
    fetchResumableExecutions();
  }, [fetchResumableExecutions]);

  // Auto-resume logic - セッション中に一度だけ実行
  useEffect(() => {
    // 既にチェック済みなら何もしない
    if (autoResumeCheckedRef.current) {
      return;
    }

    // ローディング中は待機
    if (isLoading) {
      return;
    }

    // チェック済みとしてマーク（再レンダリング防止）
    autoResumeCheckedRef.current = true;

    // 自動再開が無効、または実行対象がない場合は終了
    if (!autoResume || executions.length === 0) {
      return;
    }

    // sessionStorageでセッション中に既に実行済みかチェック
    const alreadyTriggered = sessionStorage.getItem(AUTO_RESUME_SESSION_KEY);
    if (alreadyTriggered === "true") {
      console.log("[AutoResume] Already triggered in this session, skipping");
      return;
    }

    // 自動再開を実行
    console.log(`[AutoResume] Starting auto-resume for ${executions.length} executions`);
    sessionStorage.setItem(AUTO_RESUME_SESSION_KEY, "true");

    const resumeAll = async () => {
      for (const exec of executions) {
        if (exec.canResume) {
          await handleResume(exec.id, true);
        }
      }
      onAutoResumeComplete?.();
    };
    resumeAll();
  }, [autoResume, isLoading, executions, onAutoResumeComplete]);

  // Resume a specific execution
  const handleResume = async (executionId: number, isAutoResume = false) => {
    setResumingIds((prev) => new Set(prev).add(executionId));

    try {
      const res = await fetch(
        `${API_BASE_URL}/agents/executions/${executionId}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );

      if (res.ok) {
        const data = await res.json();
        // Remove from list after successful resume
        setExecutions((prev) => prev.filter((e) => e.id !== executionId));
        // Redirect to task page (only if not auto-resuming multiple)
        if (!isAutoResume && data.taskId) {
          window.location.href = `/tasks/${data.taskId}`;
        }
      } else {
        console.error("Failed to resume execution");
      }
    } catch (error) {
      console.error("Error resuming execution:", error);
    } finally {
      setResumingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(executionId);
        return newSet;
      });
    }
  };

  // Dismiss (acknowledge) a specific execution
  const handleDismiss = async (executionId: number) => {
    setDismissingIds((prev) => new Set(prev).add(executionId));

    try {
      const res = await fetch(
        `${API_BASE_URL}/agents/executions/${executionId}/acknowledge`,
        {
          method: "POST",
        },
      );

      if (res.ok) {
        // Remove from list
        setExecutions((prev) => prev.filter((e) => e.id !== executionId));
      }
    } catch (error) {
      console.error("Error dismissing execution:", error);
    } finally {
      setDismissingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(executionId);
        return newSet;
      });
    }
  };

  // Dismiss all
  const handleDismissAll = async () => {
    for (const exec of executions) {
      await handleDismiss(exec.id);
    }
    setIsDismissed(true);
  };

  // Resume all
  const handleResumeAll = async () => {
    for (const exec of executions) {
      if (exec.canResume) {
        await handleResume(exec.id, true);
      }
    }
  };

  // Format time ago
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}日前`;
    if (diffHours > 0) return `${diffHours}時間前`;
    if (diffMins > 0) return `${diffMins}分前`;
    return "たった今";
  };

  // Don't show if loading, dismissed, or no executions
  if (isLoading || isDismissed || executions.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-20 right-6 z-50 max-w-sm w-full animate-in slide-in-from-right-4 duration-300">
      <div className="bg-linear-to-br from-amber-50 to-orange-50 dark:from-amber-950/95 dark:to-orange-950/95 border border-amber-200/80 dark:border-amber-700/60 rounded-2xl shadow-xl shadow-amber-500/10 dark:shadow-amber-900/20 overflow-hidden backdrop-blur-sm">
        {/* Header */}
        <div
          className="px-4 py-3.5 flex items-center justify-between cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="p-2 bg-linear-to-br from-amber-400 to-orange-500 rounded-xl shadow-lg shadow-amber-500/30">
                <RotateCcw className="w-4 h-4 text-white" />
              </div>
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500 text-[10px] font-bold text-white items-center justify-center">
                  {executions.length}
                </span>
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-amber-900 dark:text-amber-100 text-sm">
                中断された作業
              </h3>
              <p className="text-xs text-amber-600 dark:text-amber-400/80">
                {executions.length}件を再開できます
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDismissAll();
              }}
              className="p-1.5 hover:bg-amber-200/60 dark:hover:bg-amber-800/40 rounded-lg transition-colors"
              title="すべて閉じる"
            >
              <X className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </button>
            <div className="p-1.5">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              ) : (
                <ChevronUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              )}
            </div>
          </div>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="px-3 pb-3 space-y-2 max-h-72 overflow-y-auto">
            {executions.map((exec) => (
              <div
                key={exec.id}
                className="p-3 bg-white/80 dark:bg-zinc-900/80 rounded-xl border border-amber-100 dark:border-amber-800/40 hover:border-amber-200 dark:hover:border-amber-700/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <a
                      href={`/tasks/${exec.taskId}`}
                      className="font-medium text-sm text-zinc-900 dark:text-zinc-100 hover:text-amber-600 dark:hover:text-amber-400 truncate block transition-colors"
                    >
                      {exec.taskTitle || `タスク #${exec.taskId}`}
                    </a>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Clock className="w-3 h-3 text-zinc-400" />
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatTimeAgo(exec.startedAt || exec.createdAt)}に中断
                      </p>
                    </div>
                  </div>
                </div>

                {/* Last output preview */}
                {exec.output && (
                  <div className="mb-2.5 p-2 bg-zinc-50 dark:bg-zinc-800/60 rounded-lg text-xs font-mono text-zinc-600 dark:text-zinc-400 max-h-14 overflow-hidden line-clamp-2">
                    {exec.output.slice(-150)}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleResume(exec.id)}
                    disabled={resumingIds.has(exec.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                  >
                    {resumingIds.has(exec.id) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    再開
                  </button>
                  <a
                    href={`/tasks/${exec.taskId}`}
                    className="flex items-center gap-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    詳細
                  </a>
                  <button
                    onClick={() => handleDismiss(exec.id)}
                    disabled={dismissingIds.has(exec.id)}
                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
                    title="閉じる"
                  >
                    {dismissingIds.has(exec.id) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick actions when collapsed */}
        {!isExpanded && executions.length > 0 && (
          <div className="px-3 pb-3 flex items-center gap-2">
            <button
              onClick={() => handleResume(executions[0].id)}
              disabled={resumingIds.has(executions[0].id)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
            >
              {resumingIds.has(executions[0].id) ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              最新を再開
            </button>
            {executions.length > 1 && (
              <button
                onClick={handleResumeAll}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                全て再開
              </button>
            )}
            <button
              onClick={() => setIsExpanded(true)}
              className="px-3 py-2 bg-white/60 dark:bg-zinc-800/60 hover:bg-white dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg text-xs font-medium transition-colors border border-amber-200/50 dark:border-amber-700/30"
            >
              詳細
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import {
  Play,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Clock,
  Zap,
  RotateCcw,
  Bot,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { useBackendHealth } from '@/hooks/use-backend-health';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { useTaskDetailVisibilityStore } from '@/stores/taskDetailVisibilityStore';
import { createLogger } from '@/lib/logger';
const logger = createLogger('ResumableExecutionsBanner');

// セッション中に自動再開が実行済みかどうかを追跡するグローバルフラグ
const AUTO_RESUME_SESSION_KEY = 'rapitas_auto_resume_triggered';

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

export function ResumableExecutionsBanner() {
  const t = useTranslations('banner');
  const tc = useTranslations('common');
  const tNotification = useTranslations('notification');
  const pathname = usePathname();

  const [executions, setExecutions] = useState<ResumableExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [resumingIds, setResumingIds] = useState<Set<number>>(new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<number>>(new Set());
  const [autoResume, setAutoResume] = useState(false);
  const [connectionError, setConnectionError] = useState<Error | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // セッション中に一度だけ自動再開を実行するためのフラグ
  const autoResumeCheckedRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  // グローバルストアの実行中タスク数を監視
  const executingTasksSize = useExecutionStateStore(
    (state) => state.executingTasks.size,
  );

  // タスク詳細表示状態を監視
  const isTaskDetailVisible = useTaskDetailVisibilityStore(
    (state) => state.isTaskDetailVisible,
  );

  // バックエンドから自動再開設定を取得
  const fetchAutoResumeSetting = useCallback(async () => {
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/settings`,
        undefined,
        2,
        500,
        10000,
        { silent: true },
      );
      if (res.ok) {
        const data = await res.json();
        setAutoResume(data.autoResumeInterruptedTasks ?? false);
      } else {
        logger.warn(
          `Failed to fetch auto-resume setting: ${res.status} ${res.statusText}`,
        );
      }
    } catch (error) {
      logger.warn('Failed to fetch auto-resume setting:', error);
      // バックエンドが利用できない場合はデフォルト値を使用
      setAutoResume(false);
    }
  }, []);

  // Fetch resumable executions on mount
  const fetchResumableExecutions = useCallback(async () => {
    try {
      setConnectionError(null);
      const res = await fetchWithRetry(
        `${API_BASE_URL}/agents/resumable-executions`,
        undefined,
        2,
        500,
        5000, // 5秒タイムアウト
        { silent: true },
      );
      if (res.ok) {
        const data: ResumableExecution[] = await res.json();
        setExecutions((prev) => {
          // 新しい実行が追加された場合のみ dismissed をリセット
          const prevIds = new Set(prev.map((e) => e.id));
          const hasNewExecutions = data.some((e) => !prevIds.has(e.id));
          if (hasNewExecutions && data.length > 0) {
            setIsDismissed(false);
          }
          return data;
        });
        return data;
      } else {
        logger.warn(
          `Failed to fetch resumable executions: ${res.status} ${res.statusText}`,
        );
        // エラーレスポンスの場合は空配列を設定
        setExecutions([]);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to fetch resumable executions: ${errMsg}`);

      // ネットワークエラーの場合は接続エラーとして記録
      setConnectionError(
        error instanceof Error ? error : new Error(String(error)),
      );
      setExecutions([]);
    } finally {
      setIsLoading(false);
    }
    return [];
  }, []);

  // バックエンド復帰時に再フェッチする
  const { isConnected } = useBackendHealth({
    onReconnectAction: () => {
      logger.info(
        'Backend reconnected, re-fetching executions',
      );
      setIsLoading(true);
      setConnectionError(null);
      fetchResumableExecutions();
    },
    onDisconnectAction: () => {
      logger.info('Backend disconnected');
      setConnectionError(
        new Error(t('backendDisconnected')),
      );
    },
  });

  // バックエンド接続確認後に初回フェッチを実行（レースコンディション防止）
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (!isConnected || initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    logger.debug(
      'Backend connected, fetching initial data',
    );
    fetchAutoResumeSetting();
    fetchResumableExecutions();
  }, [isConnected, fetchAutoResumeSetting, fetchResumableExecutions]);

  // グローバルストアに新しい実行タスクが追加されたら即座にフェッチ
  const prevExecutingTasksSizeRef = useRef(executingTasksSize);
  useEffect(() => {
    if (executingTasksSize > prevExecutingTasksSizeRef.current && isConnected) {
      fetchResumableExecutions();
    }
    prevExecutingTasksSizeRef.current = executingTasksSize;
  }, [executingTasksSize, isConnected, fetchResumableExecutions]);

  // 定期的にポーリングして新しい実行の開始や完了を検出する
  useEffect(() => {
    if (isDismissed || !isConnected) return;

    const hasRunningExecutions = executions.some(
      (e) => e.status === 'running' || e.status === 'waiting_for_input',
    );
    // 実行中タスクがある場合は10秒間隔、ない場合は15秒間隔
    const pollInterval = hasRunningExecutions ? 10000 : 15000;

    const interval = setInterval(() => {
      // バックエンドが接続されている場合のみポーリング
      if (isConnected) {
        fetchResumableExecutions();
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [executions, isDismissed, isConnected, fetchResumableExecutions]);

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

    // 自動再開が無効、または再開可能な実行がない場合は終了
    const resumableExecutions = executions.filter((e) => e.canResume);
    if (!autoResume || resumableExecutions.length === 0) {
      return;
    }

    // sessionStorageでセッション中に既に実行済みかチェック
    const alreadyTriggered = sessionStorage.getItem(AUTO_RESUME_SESSION_KEY);
    if (alreadyTriggered === 'true') {
      logger.debug('Already triggered in this session, skipping');
      return;
    }

    // 自動再開を実行
    logger.info(
      `Starting auto-resume for ${resumableExecutions.length} executions`,
    );
    sessionStorage.setItem(AUTO_RESUME_SESSION_KEY, 'true');

    const resumeAll = async () => {
      for (const exec of resumableExecutions) {
        await handleResume(exec.id, true);
      }
    };
    resumeAll();
  }, [autoResume, isLoading, executions]);

  // プルダウンの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        dropdownButtonRef.current &&
        !dropdownButtonRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDropdown(false);
      }
    };

    const handleResize = () => {
      if (showDropdown && dropdownButtonRef.current) {
        const rect = dropdownButtonRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom + 8,
          left: rect.left,
          width: rect.width,
        });
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleResize, true);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [showDropdown]);

  // Resume a specific execution
  const handleResume = async (executionId: number, isAutoResume = false) => {
    setResumingIds((prev) => new Set(prev).add(executionId));

    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/agents/executions/${executionId}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );

      if (res.ok) {
        const data = await res.json();
        // Remove from list after successful resume
        setExecutions((prev) => prev.filter((e) => e.id !== executionId));
        // Redirect to task page (only if not auto-resuming multiple)
        if (!isAutoResume && data.taskId) {
          // 再開処理がバックエンドで開始されるまで少し待つ
          await new Promise((resolve) => setTimeout(resolve, 500));
          window.location.href = `/tasks/${data.taskId}?showHeader=true`;
        }
      } else {
        logger.error(
          `Failed to resume execution: ${res.status} ${res.statusText}`,
        );
        if (!isAutoResume) {
          // Show user-friendly error for manual resume attempts
          alert(
            `${tc('errorOccurred')}: ${res.status}`,
          );
        }
      }
    } catch (error) {
      logger.warn('Error resuming execution:', error);
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
    const exec = executions.find((e) => e.id === executionId);

    // 実行中の場合はローカルでのみ非表示にする（APIは呼ばない）
    if (
      exec &&
      (exec.status === 'running' || exec.status === 'waiting_for_input')
    ) {
      setExecutions((prev) => prev.filter((e) => e.id !== executionId));
      return;
    }

    setDismissingIds((prev) => new Set(prev).add(executionId));

    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/agents/executions/${executionId}/acknowledge`,
        {
          method: 'POST',
        },
      );

      if (res.ok) {
        // Remove from list
        setExecutions((prev) => prev.filter((e) => e.id !== executionId));
      } else {
        logger.error(
          `Failed to dismiss execution: ${res.status} ${res.statusText}`,
        );
      }
    } catch (error) {
      logger.warn('Error dismissing execution:', error);
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

    if (diffDays > 0) return tNotification('daysAgo', { count: diffDays });
    if (diffHours > 0) return tNotification('hoursAgo', { count: diffHours });
    if (diffMins > 0) return tNotification('minutesAgo', { count: diffMins });
    return tNotification('justNow');
  };

  // 実行中と中断の件数を集計
  const runningCount = executions.filter(
    (e) => e.status === 'running' || e.status === 'waiting_for_input',
  ).length;
  const interruptedCount = executions.filter(
    (e) => e.status === 'interrupted',
  ).length;

  // タスク詳細ページかどうかを判定（/tasks/[id] パターン）
  const isTaskDetailPage = /^\/tasks\/\d+/.test(pathname);

  // Don't show if loading, dismissed, (no executions and no error), on task detail page, or task detail panel is visible
  if (
    isLoading ||
    isDismissed ||
    (executions.length === 0 && !connectionError) ||
    isTaskDetailPage ||
    isTaskDetailVisible
  ) {
    return null;
  }

  // Show error state if there's a connection error
  if (connectionError && !isConnected) {
    return (
      <div className="fixed bottom-20 right-6 z-50 max-w-sm w-full animate-in slide-in-from-right-4 duration-300">
        <div className="border rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm bg-red-50 dark:bg-red-950/95 border-red-200/80 dark:border-red-700/60">
          <div className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-500 shadow-lg">
                <X className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm text-red-900 dark:text-red-100">
                  {t('connectionError')}
                </h3>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t('backendUnreachable')}
                </p>
              </div>
              <button
                onClick={() => {
                  setConnectionError(null);
                  fetchResumableExecutions();
                }}
                className="p-1.5 rounded-lg hover:bg-red-200/60 dark:hover:bg-red-800/40"
              >
                <RotateCcw className="w-4 h-4 text-red-600 dark:text-red-400" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // バナーのスタイルを実行中と中断で切り替え
  const hasRunning = runningCount > 0;

  return (
    <div className="fixed bottom-20 right-6 z-50 max-w-sm w-full animate-in slide-in-from-right-4 duration-300">
      <div
        className={`border rounded-2xl shadow-xl backdrop-blur-sm ${
          hasRunning
            ? 'bg-linear-to-br from-blue-50 to-indigo-50 dark:from-blue-950/95 dark:to-indigo-950/95 border-blue-200/80 dark:border-blue-700/60 shadow-blue-500/10 dark:shadow-blue-900/20'
            : 'bg-linear-to-br from-amber-50 to-orange-50 dark:from-amber-950/95 dark:to-orange-950/95 border-amber-200/80 dark:border-amber-700/60 shadow-amber-500/10 dark:shadow-amber-900/20'
        }`}
      >
        {/* Header */}
        <div
          className={`px-4 py-3.5 flex items-center justify-between cursor-pointer transition-colors ${
            hasRunning
              ? 'hover:bg-blue-100/50 dark:hover:bg-blue-900/30'
              : 'hover:bg-amber-100/50 dark:hover:bg-amber-900/30'
          }`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className={`p-2 rounded-xl shadow-lg ${
                  hasRunning
                    ? 'bg-linear-to-br from-blue-400 to-indigo-500 shadow-blue-500/30'
                    : 'bg-linear-to-br from-amber-400 to-orange-500 shadow-amber-500/30'
                }`}
              >
                {hasRunning ? (
                  <Bot className="w-4 h-4 text-white" />
                ) : (
                  <RotateCcw className="w-4 h-4 text-white" />
                )}
              </div>
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    hasRunning ? 'bg-blue-400' : 'bg-amber-400'
                  }`}
                ></span>
                <span
                  className={`relative inline-flex rounded-full h-4 w-4 text-[10px] font-bold text-white items-center justify-center ${
                    hasRunning ? 'bg-blue-500' : 'bg-amber-500'
                  }`}
                >
                  {executions.length}
                </span>
              </span>
            </div>
            <div>
              <h3
                className={`font-semibold text-sm ${
                  hasRunning
                    ? 'text-blue-900 dark:text-blue-100'
                    : 'text-amber-900 dark:text-amber-100'
                }`}
              >
                {hasRunning ? t('inProgressWork') : t('interruptedWork')}
              </h3>
              <p
                className={`text-xs ${
                  hasRunning
                    ? 'text-blue-600 dark:text-blue-400/80'
                    : 'text-amber-600 dark:text-amber-400/80'
                }`}
              >
                {runningCount > 0 && t('runningCount', { count: runningCount })}
                {runningCount > 0 && interruptedCount > 0 && ' / '}
                {interruptedCount > 0 && t('resumableCount', { count: interruptedCount })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDismissAll();
              }}
              className={`p-1.5 rounded-lg transition-colors ${
                hasRunning
                  ? 'hover:bg-blue-200/60 dark:hover:bg-blue-800/40'
                  : 'hover:bg-amber-200/60 dark:hover:bg-amber-800/40'
              }`}
              title={t('closeAll')}
            >
              <X
                className={`w-4 h-4 ${
                  hasRunning
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              />
            </button>
            <div className="p-1.5">
              {isExpanded ? (
                <ChevronDown
                  className={`w-4 h-4 ${
                    hasRunning
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                />
              ) : (
                <ChevronUp
                  className={`w-4 h-4 ${
                    hasRunning
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                />
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
                    <div className="flex items-center gap-1.5">
                      <a
                        href={`/tasks/${exec.taskId}?showHeader=true`}
                        className="font-medium text-sm text-zinc-900 dark:text-zinc-100 hover:text-amber-600 dark:hover:text-amber-400 truncate block transition-colors"
                      >
                        {exec.taskTitle || `${t('taskPrefix')}${exec.taskId}`}
                      </a>
                      {(exec.status === 'running' ||
                        exec.status === 'waiting_for_input') && (
                        <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[9px] font-medium rounded-full">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          {t('runningStatus')}
                        </span>
                      )}
                      {exec.status === 'interrupted' && (
                        <span className="shrink-0 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[9px] font-medium rounded-full">
                          {t('interruptedStatus')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Clock className="w-3 h-3 text-zinc-400" />
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {exec.status === 'interrupted'
                          ? t('interruptedAt', { time: formatTimeAgo(exec.startedAt || exec.createdAt) })
                          : t('startedAt', { time: formatTimeAgo(exec.startedAt || exec.createdAt) })}
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
                  {exec.canResume ? (
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
                      {tc('resume')}
                    </button>
                  ) : null}
                  <a
                    href={`/tasks/${exec.taskId}?showHeader=true`}
                    className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      !exec.canResume
                        ? 'flex-1 bg-linear-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white shadow-sm hover:shadow-md'
                        : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t('details')}
                  </a>
                  <button
                    onClick={() => handleDismiss(exec.id)}
                    disabled={dismissingIds.has(exec.id)}
                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
                    title={tc('close')}
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
            {/* 1件のみの場合は現行のボタン表示 */}
            {executions.length === 1 ? (
              <>
                {executions[0].canResume ? (
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
                    {t('resumeLatest')}
                  </button>
                ) : (
                  <a
                    href={`/tasks/${executions[0].taskId}?showHeader=true`}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-linear-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-lg text-xs font-semibold transition-all shadow-sm hover:shadow-md"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t('viewRunningTask')}
                  </a>
                )}
              </>
            ) : (
              /* 複数件の場合はプルダウン形式 */
              <div className="relative flex-1 min-w-0" ref={dropdownRef}>
                <div className="relative">
                  <button
                    ref={dropdownButtonRef}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!showDropdown && dropdownButtonRef.current) {
                        const rect =
                          dropdownButtonRef.current.getBoundingClientRect();
                        setDropdownPosition({
                          top: rect.bottom + 8,
                          left: rect.left,
                          width: rect.width,
                        });
                      }
                      setShowDropdown(!showDropdown);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      hasRunning
                        ? 'bg-linear-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white'
                        : 'bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white'
                    } ${showDropdown ? 'shadow-lg scale-[0.98]' : 'shadow-sm hover:shadow-md'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Bot className="w-3.5 h-3.5" />
                      <span>
                        {runningCount > 0
                          ? t('runningCount', { count: runningCount })
                          : t('resumableCount', { count: interruptedCount })}
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {/* プルダウンメニュー */}
                  {showDropdown &&
                    typeof window !== 'undefined' &&
                    createPortal(
                      <div
                        ref={dropdownRef}
                        className="fixed bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-2xl z-100 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200"
                        style={{
                          top: `${dropdownPosition.top}px`,
                          left: `${dropdownPosition.left}px`,
                          width: `${dropdownPosition.width}px`,
                          maxWidth: '24rem',
                        }}
                      >
                        <div className="max-h-64 overflow-y-auto rounded-lg">
                          {executions.map((exec) => (
                            <a
                              key={exec.id}
                              href={`/tasks/${exec.taskId}?showHeader=true`}
                              onClick={() => setShowDropdown(false)}
                              className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                                    {exec.taskTitle || `${t('taskPrefix')}${exec.taskId}`}
                                  </span>
                                  {(exec.status === 'running' ||
                                    exec.status === 'waiting_for_input') && (
                                    <span className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[9px] font-medium rounded">
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                    </span>
                                  )}
                                  {exec.status === 'interrupted' && (
                                    <span className="shrink-0 px-1 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[9px] font-medium rounded">
                                      {t('interruptedStatus')}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                  {formatTimeAgo(
                                    exec.startedAt || exec.createdAt,
                                  )}
                                </p>
                              </div>
                              <ExternalLink className="w-3 h-3 text-zinc-400 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>,
                      document.body,
                    )}
                </div>
              </div>
            )}
            {/* 複数の中断タスクがある場合の全て再開ボタン */}
            {interruptedCount > 1 && (
              <button
                onClick={handleResumeAll}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  hasRunning
                    ? 'bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-700 dark:text-amber-300'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                {t('resumeAll')}
              </button>
            )}
            {/* 1件の場合でも詳細ボタンを表示 */}
            {executions.length === 1 && (
              <button
                onClick={() => setIsExpanded(true)}
                className={`px-3 py-2 bg-white/60 dark:bg-zinc-800/60 hover:bg-white dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg text-xs font-medium transition-colors border ${
                  hasRunning
                    ? 'border-blue-200/50 dark:border-blue-700/30'
                    : 'border-amber-200/50 dark:border-amber-700/30'
                }`}
              >
                {t('details')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

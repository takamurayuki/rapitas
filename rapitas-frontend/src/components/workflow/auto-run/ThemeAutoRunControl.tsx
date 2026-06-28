/**
 * ThemeAutoRunControl
 *
 * Compact UI for starting, pausing, and stopping per-theme auto-execution.
 * Shows current status badge, the in-progress task title, and processed count.
 * Designed to fit in the theme filter row of the home page.
 */
'use client';
import React, { useState } from 'react';
import { Play, Pause, Square, Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useThemeAutoRun, type AutoRunStatus } from '@/hooks/workflow/useThemeAutoRun';
import { useTranslations } from 'next-intl';

interface ThemeAutoRunControlProps {
  /** Theme ID to control / 制御するテーマID */
  themeId: number;
  /** Whether the theme is a development theme (has workingDirectory) / 開発テーマか */
  isDevelopment?: boolean;
}

/** Visual config per auto-run status. */
const STATUS_CONFIG: Record<
  AutoRunStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    darkBg: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  idle: {
    label: '待機',
    color: 'text-zinc-500 dark:text-zinc-400',
    bgColor: 'bg-zinc-100',
    darkBg: 'dark:bg-zinc-800',
    icon: Clock,
  },
  running: {
    label: '実行中',
    color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-100',
    darkBg: 'dark:bg-emerald-900/30',
    icon: CheckCircle2,
  },
  paused: {
    label: '一時停止',
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100',
    darkBg: 'dark:bg-amber-900/30',
    icon: Pause,
  },
  stopping: {
    label: '停止中',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100',
    darkBg: 'dark:bg-red-900/30',
    icon: Loader2,
  },
};

/**
 * Compact control widget for theme auto-run.
 *
 * @param props - themeId + isDevelopment flag
 * @returns Auto-run control JSX / 自動実行コントロールJSX
 */
export function ThemeAutoRunControl({ themeId, isDevelopment }: ThemeAutoRunControlProps) {
  const t = useTranslations('autoRun');
  const { data, loading, actionLoading, error, start, pause, stop } = useThemeAutoRun(
    themeId,
    isDevelopment,
  );
  const [showError, setShowError] = useState(true);

  if (!isDevelopment) return null;
  if (loading && !data) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400">
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    );
  }

  const status: AutoRunStatus = data?.autoRun?.status ?? 'idle';
  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;
  const processedCount = data?.autoRun?.processedCount ?? 0;
  const currentTitle = data?.currentTask?.title;
  const isActive = status === 'running' || status === 'paused' || status === 'stopping';

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* Status badge */}
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${cfg.bgColor} ${cfg.darkBg} ${cfg.color}`}
      >
        <StatusIcon className={`w-2.5 h-2.5 ${status === 'stopping' ? 'animate-spin' : ''}`} />
        {cfg.label}
        {processedCount > 0 && <span className="font-bold">{processedCount}</span>}
      </span>

      {/* Current task (running/paused only) */}
      {isActive && currentTitle && (
        <span className="hidden lg:inline-block text-[10px] text-zinc-500 dark:text-zinc-400 max-w-32 truncate font-mono">
          {currentTitle}
        </span>
      )}

      {/* Approval waiting badge */}
      {status === 'paused' && data?.autoRun?.currentTaskId && (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
          {t('awaitingApproval')}
        </span>
      )}

      {/* Control buttons */}
      {status === 'idle' && (
        <button
          onClick={() => {
            setShowError(true);
            start('priority');
          }}
          disabled={actionLoading}
          title={t('startTitle')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
        >
          {actionLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
          {t('start')}
        </button>
      )}

      {status === 'running' && (
        <>
          <button
            onClick={() => {
              setShowError(true);
              pause();
            }}
            disabled={actionLoading}
            title={t('pauseTitle')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 dark:hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            {actionLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Pause className="w-3 h-3" />
            )}
            {t('pause')}
          </button>
          <button
            onClick={() => {
              setShowError(true);
              stop();
            }}
            disabled={actionLoading}
            title={t('stopTitle')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-500/30 transition-colors disabled:opacity-50"
          >
            <Square className="w-3 h-3 fill-current" />
            {t('stop')}
          </button>
        </>
      )}

      {status === 'paused' && (
        <>
          <button
            onClick={() => {
              setShowError(true);
              start('priority');
            }}
            disabled={actionLoading}
            title={t('resumeTitle')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
          >
            {actionLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3 fill-current" />
            )}
            {t('resume')}
          </button>
          <button
            onClick={() => {
              setShowError(true);
              stop();
            }}
            disabled={actionLoading}
            title={t('stopTitle')}
            className="inline-flex items-center gap-1 pl-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-500/30 transition-colors disabled:opacity-50"
          >
            <Square className="w-3 h-3 fill-current" />
            {t('stop')}
          </button>
        </>
      )}

      {/* Error toast */}
      {error && showError && (
        <div
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 cursor-pointer"
          onClick={() => setShowError(false)}
          title={error}
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-32">{error}</span>
        </div>
      )}
    </div>
  );
}

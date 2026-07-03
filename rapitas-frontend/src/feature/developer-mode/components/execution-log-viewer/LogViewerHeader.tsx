'use client';

/**
 * execution-log-viewer/LogViewerHeader.tsx
 *
 * Header bar for ExecutionLogViewer. Contains the title, status badge, an
 * always-visible search box (filters the log entries) with an "errors only"
 * quick-filter, and action buttons (scroll-to-bottom, copy, fullscreen toggle,
 * collapse).
 */

import React from 'react';
import {
  Terminal,
  ChevronUp,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Search,
  X,
  ArrowDown,
  CheckCircle2,
  AlertCircle,
  Square,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ExecutionLogStatus } from './types';

type LogViewerHeaderProps = {
  status: ExecutionLogStatus;
  /** Task id — rendered as `Task #<id>` so the run is easy to reference/share. */
  taskId?: number;
  isRunning: boolean;
  isFullscreen: boolean;
  collapsible: boolean;
  autoScroll: boolean;
  copied: boolean;
  searchQuery: string;
  /** Number of entries currently shown (after filtering). */
  matchCount: number;
  /** Whether the errors-only quick-filter is active. */
  errorOnly: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onScrollToBottom: () => void;
  onCopyLogs: () => void;
  onToggleFullscreen: () => void;
  onToggleExpanded: () => void;
  onToggleErrorOnly: () => void;
  onSearchQueryChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchKeyDown: (e: React.KeyboardEvent) => void;
  onClearSearchQuery: () => void;
};

/**
 * Renders the top control bar of the log viewer.
 *
 * All interactive state lives in the parent; this component is purely
 * presentational and forwards events via callback props.
 *
 * @param props - See {@link LogViewerHeaderProps} for full documentation.
 */
export const LogViewerHeader: React.FC<LogViewerHeaderProps> = ({
  status,
  taskId,
  isRunning,
  isFullscreen,
  collapsible,
  autoScroll,
  copied,
  searchQuery,
  matchCount,
  errorOnly,
  searchInputRef,
  onScrollToBottom,
  onCopyLogs,
  onToggleFullscreen,
  onToggleExpanded,
  onToggleErrorOnly,
  onSearchQueryChange,
  onSearchKeyDown,
  onClearSearchQuery,
}) => {
  const t = useTranslations('devMode.logViewerHeader');
  const statusBadge = buildStatusBadge(status, isRunning, t);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-zinc-800 rounded-t-lg border-b border-zinc-700">
      {/* Left: title + badges */}
      <div className="flex items-center gap-2">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="text-sm font-medium text-zinc-200">{t('title')}</span>
        {taskId != null && (
          <span
            className="px-1.5 py-0.5 bg-zinc-700 text-zinc-300 rounded text-xs font-mono"
            title={t('taskIdTooltip')}
          >
            Task #{taskId}
          </span>
        )}
        {statusBadge}
      </div>

      {/* Right: controls — search box is always visible to aid log review */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center gap-1">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={onSearchQueryChange}
              onKeyDown={onSearchKeyDown}
              placeholder={t('searchPlaceholder')}
              className="w-44 px-3 py-1 pl-7 bg-zinc-900 border border-zinc-600 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-400 focus:w-60 transition-all"
            />
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
          </div>
          {searchQuery && (
            <>
              <span
                className={`text-xs whitespace-nowrap ${matchCount > 0 ? 'text-zinc-400' : 'text-amber-400'}`}
              >
                {t('matchCount', { count: matchCount })}
              </span>
              <button
                onClick={onClearSearchQuery}
                className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
                title={t('clearSearchTooltip')}
              >
                <X className="w-3 h-3" />
              </button>
            </>
          )}
        </div>

        {/* Errors-only quick filter */}
        <button
          onClick={onToggleErrorOnly}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            errorOnly
              ? 'text-red-300 bg-red-500/20'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
          title={errorOnly ? t('showAllTooltip') : t('errorsOnlyTooltip')}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          {t('errorsOnly')}
        </button>

        <div className="w-px h-4 bg-zinc-600" />

        <button
          onClick={onScrollToBottom}
          className={`p-1.5 rounded transition-colors ${
            autoScroll
              ? 'text-green-400 bg-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
          title={autoScroll ? t('autoScrollingTooltip') : t('scrollToBottomTooltip')}
        >
          <ArrowDown className="w-4 h-4" />
        </button>

        <button
          onClick={onCopyLogs}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
          title={t('copyLogsTooltip')}
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>

        <button
          onClick={onToggleFullscreen}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
          title={isFullscreen ? t('shrinkTooltip') : t('expandTooltip')}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {collapsible && (
          <button
            onClick={onToggleExpanded}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
            title={t('collapseTooltip')}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Build the coloured status badge element for the given execution state.
 *
 * Returns `null` when no badge is appropriate (e.g. idle with no status).
 *
 * @param status - Current execution status. / 現在の実行ステータス。
 * @param isRunning - Whether execution is actively running. / 実行が進行中かどうか。
 * @param t - Scoped translation function for this component. / このコンポーネント用の翻訳関数。
 * @returns Badge element or `null`. / バッジ要素または `null`。
 */
function buildStatusBadge(
  status: ExecutionLogStatus,
  isRunning: boolean,
  t: (key: string) => string,
): React.ReactNode {
  if (isRunning || status === 'running') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        {t('statusRunning')}
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">
        <Square className="w-3 h-3" />
        {t('statusCancelled')}
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">
        <CheckCircle2 className="w-3 h-3" />
        {t('statusCompleted')}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
        <AlertCircle className="w-3 h-3" />
        {t('statusFailed')}
      </span>
    );
  }
  return null;
}

'use client';

/**
 * execution-log-viewer/ExecutionLogViewer.tsx
 *
 * AI agent execution log viewer component.
 *
 * Standalone execution log viewer independent of status cards. Always renders the
 * formatted, icon-based log (no mode toggle) with an always-visible search box
 * (filters + highlights entries), an "errors only" quick-filter, and a final
 * execution summary. The log body fills the panel — no progress/stats strips
 * above it — to maximise the visible log area. Composes sub-components
 * (LogViewerHeader, ExecutionSummaryCard, SimpleLogEntryList) and delegates all
 * state logic to useLogViewer.
 */

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Terminal, ChevronDown, Loader2, SearchX } from 'lucide-react';
import { SimpleLogEntryList } from '../SimpleLogEntry';
import { LogViewerHeader } from './LogViewerHeader';
import { ExecutionSummaryCard } from './ExecutionSummaryCard';
import { useLogViewer } from './useLogViewer';
import type { ExecutionLogViewerProps } from './types';

export type { ExecutionLogStatus, ExecutionLogViewMode, ExecutionLogViewerProps } from './types';

/**
 * Displays execution logs with auto-scroll, search filtering, an errors-only
 * quick-filter, copy, and fullscreen. The log is always shown in the formatted,
 * icon-based view.
 *
 * @param logs - Array of log strings to display. / 表示するログ文字列の配列。
 * @param status - Current execution status. / 現在の実行ステータス。
 * @param isConnected - Indicates if real-time streaming is active. / リアルタイムストリーミングが有効かどうか。
 * @param isRunning - Indicates if the execution is currently running. / 実行が進行中かどうか。
 * @param defaultExpanded - Whether the log viewer is expanded by default. / デフォルトで展開するかどうか。
 * @param defaultFullscreen - Whether the log viewer starts in fullscreen mode. / フルスクリーンモードで開始するかどうか。
 * @param className - Additional CSS classes for the root element. / ルート要素への追加CSSクラス。
 * @param collapsible - Whether the log viewer can be collapsed. / 折り畳み可能かどうか。
 * @param showHeader - Whether to display the header bar. / ヘッダーバーを表示するかどうか。
 * @param maxHeight - Maximum height of the log viewer (when not fullscreen). / 最大高さ（フルスクリーン以外）。
 */
export const ExecutionLogViewer: React.FC<ExecutionLogViewerProps> = ({
  logs,
  status,
  isConnected = false,
  isRunning = false,
  defaultExpanded = true,
  defaultFullscreen = false,
  className = '',
  collapsible = true,
  showHeader = true,
  maxHeight = 256,
  taskId,
}) => {
  const t = useTranslations('devMode.executionLogViewer');
  const tLog = useTranslations('devMode.logTransformer');
  const {
    isExpanded,
    isFullscreen,
    copied,
    autoScroll,
    searchQuery,
    highlightQuery,
    searchInputRef,
    errorOnly,
    hasActiveFilter,
    matchCount,
    logContainerRef,
    displayedLogsCount,
    filteredSimpleEntries,
    executionSummary,
    handleScroll,
    handleScrollStart,
    handleScrollEnd,
    scrollToBottom,
    toggleFullscreen,
    toggleExpanded,
    toggleErrorOnly,
    handleCopyLogs,
    clearSearchQuery,
    handleSearchQueryChange,
    handleSearchKeyDown,
    highlightText,
  } = useLogViewer({
    logs,
    defaultExpanded,
    defaultFullscreen,
    t: tLog,
  });

  // Formatted log entries (filtered by search / errors-only). New-entry animation
  // is suppressed while filtering since the list isn't tracking the live tail.
  const logContent = useMemo(() => {
    if (logs.length === 0) return null;
    const newEntriesCount = hasActiveFilter
      ? 0
      : Math.max(0, filteredSimpleEntries.length - (displayedLogsCount - 5));
    return (
      <SimpleLogEntryList
        entries={filteredSimpleEntries}
        newEntriesCount={newEntriesCount}
        searchQuery={highlightQuery}
        highlightText={highlightText}
      />
    );
  }, [
    logs.length,
    filteredSimpleEntries,
    hasActiveFilter,
    displayedLogsCount,
    highlightQuery,
    highlightText,
  ]);

  // Collapsed state: show a minimal button
  if (collapsible && !isExpanded && logs.length > 0) {
    return (
      <button
        onClick={toggleExpanded}
        className={`w-full px-4 py-2 flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors ${className}`}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-zinc-200">{t('executionLog')}</span>
          {taskId != null && (
            <span className="px-1.5 py-0.5 bg-zinc-700 text-zinc-300 rounded text-xs font-mono">
              Task #{taskId}
            </span>
          )}
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-400" />
      </button>
    );
  }

  if (logs.length === 0) {
    return null;
  }

  // No entry matches the active filter — explain why the list is empty.
  const showNoMatches = hasActiveFilter && matchCount === 0 && logs.length > 0;

  return (
    <div
      className={`transition-all duration-300 ${
        isFullscreen ? 'fixed inset-4 z-50 bg-zinc-900 rounded-xl shadow-2xl flex flex-col' : ''
      } ${className}`}
    >
      {showHeader && (
        <LogViewerHeader
          status={status}
          taskId={taskId}
          isRunning={isRunning}
          isConnected={isConnected}
          isFullscreen={isFullscreen}
          collapsible={collapsible}
          autoScroll={autoScroll}
          copied={copied}
          searchQuery={searchQuery}
          matchCount={matchCount}
          errorOnly={errorOnly}
          searchInputRef={searchInputRef}
          onScrollToBottom={scrollToBottom}
          onCopyLogs={handleCopyLogs}
          onToggleFullscreen={toggleFullscreen}
          onToggleExpanded={toggleExpanded}
          onToggleErrorOnly={toggleErrorOnly}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchKeyDown={handleSearchKeyDown}
          onClearSearchQuery={clearSearchQuery}
        />
      )}

      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        onMouseDown={handleScrollStart}
        onMouseUp={handleScrollEnd}
        onTouchStart={handleScrollStart}
        onTouchEnd={handleScrollEnd}
        className={`bg-zinc-900 overflow-auto execution-log-container break-words text-xs sm:text-sm ${
          isFullscreen ? 'flex-1' : ''
        } ${showHeader ? 'rounded-b-lg' : 'rounded-lg'}`}
        style={{ height: isFullscreen ? undefined : maxHeight }}
      >
        <div className="p-4">
          {showNoMatches ? (
            <div className="flex items-center justify-center py-8 text-zinc-500">
              <div className="text-center">
                <SearchX className="w-7 h-7 mx-auto mb-2 text-zinc-600" />
                <p className="text-sm">
                  {searchQuery ? t('noMatchForQuery', { query: searchQuery }) : t('noMatchingLogs')}
                </p>
              </div>
            </div>
          ) : (
            logContent || (
              <div className="flex items-center justify-center py-8 text-zinc-500">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
                  <p>{t('fetchingLogs')}</p>
                </div>
              </div>
            )
          )}
          {executionSummary && (status === 'completed' || status === 'failed') && (
            <ExecutionSummaryCard summary={executionSummary} status={status} />
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionLogViewer;

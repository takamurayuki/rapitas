'use client';

/**
 * execution-log-viewer/ExecutionLogViewer.tsx
 *
 * AI agent execution log viewer component.
 *
 * Standalone execution log viewer independent of status cards.
 * Composes sub-components (LogViewerHeader, LiveStatsBar,
 * ExecutionSummaryCard) and delegates all state logic to useLogViewer.
 */

import React, { useMemo } from 'react';
import { Terminal, ChevronDown, Loader2 } from 'lucide-react';
import { SimpleLogEntryList } from '../SimpleLogEntry';
import { WorkflowProgressBar } from '../WorkflowProgressBar';
import { LogViewerHeader } from './LogViewerHeader';
import { LiveStatsBar } from './LiveStatsBar';
import { ExecutionSummaryCard } from './ExecutionSummaryCard';
import { LogEntry } from './LogEntry';
import { useLogViewer } from './useLogViewer';
import type { ExecutionLogViewerProps } from './types';

export type { ExecutionLogStatus, ExecutionLogViewMode, ExecutionLogViewerProps } from './types';

/**
 * Displays execution logs with advanced features such as auto-scroll, search,
 * copy, fullscreen, and view-mode toggling.
 *
 * @param logs - Array of log strings to display. / 表示するログ文字列の配列。
 * @param status - Current execution status. / 現在の実行ステータス。
 * @param isConnected - Indicates if real-time streaming is active. / リアルタイムストリーミングが有効かどうか。
 * @param isRunning - Indicates if the execution is currently running. / 実行が進行中かどうか。
 * @param defaultExpanded - Whether the log viewer is expanded by default. / デフォルトで展開するかどうか。
 * @param defaultFullscreen - Whether the log viewer starts in fullscreen mode. / フルスクリーンモードで開始するかどうか。
 * @param defaultViewMode - Initial view mode ('simple' or 'detailed'). / 初期表示モード。
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
  defaultViewMode = 'simple',
  className = '',
  collapsible = true,
  showHeader = true,
  maxHeight = 256,
}) => {
  const {
    isExpanded,
    isFullscreen,
    viewMode,
    copied,
    autoScroll,
    searchQuery,
    searchMatches,
    currentMatchIndex,
    searchInputRef,
    logContainerRef,
    displayedLogsCount,
    simpleLogEntries,
    currentPhase,
    executionSummary,
    handleScroll,
    handleScrollStart,
    handleScrollEnd,
    scrollToBottom,
    toggleFullscreen,
    toggleExpanded,
    toggleViewMode,
    handleCopyLogs,
    clearSearchQuery,
    handleSearchQueryChange,
    handleSearchKeyDown,
    goToNextMatch,
    goToPreviousMatch,
    highlightText,
  } = useLogViewer({ logs, defaultExpanded, defaultFullscreen, defaultViewMode });

  // Memoize log content based on view mode
  const logContent = useMemo(() => {
    if (logs.length === 0) return null;

    if (viewMode === 'simple') {
      const newEntriesCount = Math.max(
        0,
        simpleLogEntries.length - (displayedLogsCount - 5),
      );
      return (
        <SimpleLogEntryList
          entries={simpleLogEntries}
          newEntriesCount={newEntriesCount}
        />
      );
    }

    // Detailed mode
    return logs.map((log, i) => {
      const isNewEntry = i >= displayedLogsCount - 5; // Animate the latest 5 entries
      return (
        <LogEntry
          key={i}
          log={log}
          index={i}
          isNewEntry={isNewEntry}
          searchQuery={searchQuery}
          highlightText={highlightText}
        />
      );
    });
  }, [
    logs,
    searchQuery,
    highlightText,
    displayedLogsCount,
    viewMode,
    simpleLogEntries,
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
          <span className="text-sm font-medium text-zinc-200">実行ログ</span>
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-400" />
      </button>
    );
  }

  if (logs.length === 0) {
    return null;
  }

  return (
    <div
      className={`transition-all duration-300 ${
        isFullscreen
          ? 'fixed inset-4 z-50 bg-zinc-900 rounded-xl shadow-2xl flex flex-col'
          : ''
      } ${className}`}
    >
      {showHeader && (
        <LogViewerHeader
          status={status}
          isRunning={isRunning}
          isConnected={isConnected}
          viewMode={viewMode}
          isFullscreen={isFullscreen}
          collapsible={collapsible}
          autoScroll={autoScroll}
          copied={copied}
          searchQuery={searchQuery}
          searchMatches={searchMatches}
          currentMatchIndex={currentMatchIndex}
          searchInputRef={searchInputRef}
          onScrollToBottom={scrollToBottom}
          onCopyLogs={handleCopyLogs}
          onToggleViewMode={toggleViewMode}
          onToggleFullscreen={toggleFullscreen}
          onToggleExpanded={toggleExpanded}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchKeyDown={handleSearchKeyDown}
          onGoToNextMatch={goToNextMatch}
          onGoToPreviousMatch={goToPreviousMatch}
          onClearSearchQuery={clearSearchQuery}
        />
      )}

      {/* Workflow progress bar (simple mode only) */}
      {viewMode === 'simple' && currentPhase && (
        <WorkflowProgressBar currentPhase={currentPhase} />
      )}

      {/* Live execution stats bar */}
      {viewMode === 'simple' &&
        executionSummary &&
        (isRunning || status === 'running') && (
          <LiveStatsBar summary={executionSummary} />
        )}

      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        onMouseDown={handleScrollStart}
        onMouseUp={handleScrollEnd}
        onTouchStart={handleScrollStart}
        onTouchEnd={handleScrollEnd}
        className={`bg-zinc-900 overflow-auto execution-log-container ${
          viewMode === 'detailed' ? 'font-mono text-sm' : 'text-sm'
        } ${isFullscreen ? 'flex-1' : ''} ${showHeader ? 'rounded-b-lg' : 'rounded-lg'}`}
        style={{ height: isFullscreen ? undefined : maxHeight }}
      >
        {viewMode === 'simple' ? (
          <div className="p-4">
            {logContent || (
              <div className="flex items-center justify-center py-8 text-zinc-500">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
                  <p>実行ログを取得中...</p>
                </div>
              </div>
            )}
            {executionSummary &&
              (status === 'completed' || status === 'failed') && (
                <ExecutionSummaryCard
                  summary={executionSummary}
                  status={status}
                />
              )}
          </div>
        ) : (
          <pre className="p-4 text-zinc-300 whitespace-pre-wrap wrap-break-words">
            {logContent || (
              <span className="text-zinc-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                実行ログを取得中...
              </span>
            )}
          </pre>
        )}
      </div>
    </div>
  );
};

export default ExecutionLogViewer;

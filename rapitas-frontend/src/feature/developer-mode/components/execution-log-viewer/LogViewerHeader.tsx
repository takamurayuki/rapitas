'use client';

/**
 * execution-log-viewer/LogViewerHeader.tsx
 *
 * Header bar for ExecutionLogViewer.  Contains the title, status badge,
 * LIVE streaming indicator, search controls (detailed mode only),
 * and action buttons (scroll-to-bottom, copy, view-mode toggle,
 * fullscreen toggle, collapse).
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
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertCircle,
  Square,
  Eye,
  Code,
} from 'lucide-react';
import type { ExecutionLogStatus, ExecutionLogViewMode } from './types';

type LogViewerHeaderProps = {
  status: ExecutionLogStatus;
  isRunning: boolean;
  isConnected: boolean;
  viewMode: ExecutionLogViewMode;
  isFullscreen: boolean;
  collapsible: boolean;
  autoScroll: boolean;
  copied: boolean;
  searchQuery: string;
  searchMatches: number[];
  currentMatchIndex: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onScrollToBottom: () => void;
  onCopyLogs: () => void;
  onToggleViewMode: () => void;
  onToggleFullscreen: () => void;
  onToggleExpanded: () => void;
  onSearchQueryChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchKeyDown: (e: React.KeyboardEvent) => void;
  onGoToNextMatch: () => void;
  onGoToPreviousMatch: () => void;
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
  isRunning,
  isConnected,
  viewMode,
  isFullscreen,
  collapsible,
  autoScroll,
  copied,
  searchQuery,
  searchMatches,
  currentMatchIndex,
  searchInputRef,
  onScrollToBottom,
  onCopyLogs,
  onToggleViewMode,
  onToggleFullscreen,
  onToggleExpanded,
  onSearchQueryChange,
  onSearchKeyDown,
  onGoToNextMatch,
  onGoToPreviousMatch,
  onClearSearchQuery,
}) => {
  const statusBadge = buildStatusBadge(status, isRunning);

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 rounded-t-lg border-b border-zinc-700">
      {/* Left: title + badges */}
      <div className="flex items-center gap-2">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="text-sm font-medium text-zinc-200">実行ログ</span>
        {statusBadge}
        {isConnected && (
          <span
            className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-xs"
            title="リアルタイムストリーミング接続中"
          >
            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
            LIVE
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-2">
        {/* Search — detailed mode only */}
        {viewMode === 'detailed' && (
          <>
            <div className="relative flex items-center gap-1">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={onSearchQueryChange}
                  onKeyDown={onSearchKeyDown}
                  placeholder="検索..."
                  className="w-40 px-3 py-1 pl-7 bg-zinc-900 border border-zinc-600 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/30 focus:w-56 transition-all"
                />
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
              </div>
              {searchQuery && (
                <>
                  <span className="text-xs text-zinc-400 whitespace-nowrap">
                    {searchMatches.length > 0
                      ? `${currentMatchIndex + 1}/${searchMatches.length}`
                      : '0件'}
                  </span>
                  <button
                    onClick={onGoToPreviousMatch}
                    disabled={searchMatches.length === 0}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="前の結果 (Shift+Enter)"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={onGoToNextMatch}
                    disabled={searchMatches.length === 0}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="次の結果 (Enter)"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={onClearSearchQuery}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
                    title="クリア"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
            <div className="w-px h-4 bg-zinc-600" />
          </>
        )}

        <button
          onClick={onScrollToBottom}
          className={`p-1.5 rounded transition-colors ${
            autoScroll
              ? 'text-green-400 bg-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
          title={autoScroll ? '自動スクロール中' : '最下部へスクロール'}
        >
          <ArrowDown className="w-4 h-4" />
        </button>

        <button
          onClick={onCopyLogs}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
          title="ログをコピー"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>

        <button
          onClick={onToggleViewMode}
          className={`p-1.5 rounded transition-colors ${
            viewMode === 'simple'
              ? 'text-blue-400 bg-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
          title={viewMode === 'simple' ? '詳細モードに切り替え' : 'シンプルモードに切り替え'}
        >
          {viewMode === 'simple' ? <Code className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>

        <button
          onClick={onToggleFullscreen}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
          title={isFullscreen ? '縮小' : '拡大'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {collapsible && (
          <button
            onClick={onToggleExpanded}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
            title="折りたたむ"
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
 * @returns Badge element or `null`. / バッジ要素または `null`。
 */
function buildStatusBadge(status: ExecutionLogStatus, isRunning: boolean): React.ReactNode {
  if (isRunning || status === 'running') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        実行中
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">
        <Square className="w-3 h-3" />
        停止
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">
        <CheckCircle2 className="w-3 h-3" />
        完了
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
        <AlertCircle className="w-3 h-3" />
        失敗
      </span>
    );
  }
  return null;
}

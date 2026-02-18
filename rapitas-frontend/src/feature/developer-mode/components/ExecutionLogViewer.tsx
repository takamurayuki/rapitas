'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  Terminal,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Square,
} from 'lucide-react';

export type ExecutionLogStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExecutionLogViewerProps = {
  /** 実行ログの配列 */
  logs: string[];
  /** 実行状態 */
  status: ExecutionLogStatus;
  /** SSE接続状態 */
  isConnected?: boolean;
  /** 実行中かどうか */
  isRunning?: boolean;
  /** 初期表示時に展開するか */
  defaultExpanded?: boolean;
  /** フルスクリーンモードで開始するか */
  defaultFullscreen?: boolean;
  /** カスタムクラス名 */
  className?: string;
  /** 折りたたみ可能かどうか */
  collapsible?: boolean;
  /** ヘッダーを表示するか */
  showHeader?: boolean;
  /** ログの最大高さ（px） */
  maxHeight?: number;
};

/**
 * ExecutionLogViewer - AIエージェント実行ログの表示コンポーネント
 *
 * ステータスカードから独立した実行ログビューワーです。
 * 検索、自動スクロール、フルスクリーンモードなどの機能を提供します。
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
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isFullscreen, setIsFullscreen] = useState(defaultFullscreen);
  const [copied, setCopied] = useState(false);

  // 検索機能の状態
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const logContainerRef = useRef<HTMLDivElement>(null);
  // 自動スクロールを制御するためのフラグ
  const [autoScroll, setAutoScroll] = useState(true);
  const isUserScrollingRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const prevLogsLengthRef = useRef(0);

  // スクロール位置を監視して自動スクロールを制御
  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;
    if (!logContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isUserScrollingRef.current) {
      setAutoScroll(isNearBottom);
    }
  }, []);

  const handleScrollStart = useCallback(() => {
    isUserScrollingRef.current = true;
  }, []);

  const handleScrollEnd = useCallback(() => {
    isUserScrollingRef.current = false;
    handleScroll();
  }, [handleScroll]);

  // ログが更新されたら自動スクロール
  useEffect(() => {
    if (logs.length > prevLogsLengthRef.current) {
      if (
        logContainerRef.current &&
        autoScroll &&
        !isUserScrollingRef.current
      ) {
        isAutoScrollingRef.current = true;
        requestAnimationFrame(() => {
          if (logContainerRef.current) {
            logContainerRef.current.scrollTop =
              logContainerRef.current.scrollHeight;
          }
          setTimeout(() => {
            isAutoScrollingRef.current = false;
          }, 50);
        });
      }
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs.length, autoScroll]);

  // 検索機能（ログ長でデバウンス。ログの増加は検索をトリガーしない）
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!searchQuery.trim()) {
      if (searchMatches.length > 0 || currentMatchIndex !== 0) {
        // 非同期で更新
        const timer = setTimeout(() => {
          setSearchMatches([]);
          setCurrentMatchIndex(0);
        }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }

    // デバウンスして検索コストを削減
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      const fullText = logs.join('');
      const matches: number[] = [];
      const query = searchQuery.toLowerCase();
      let index = 0;
      let position = fullText.toLowerCase().indexOf(query, index);

      while (position !== -1) {
        matches.push(position);
        index = position + 1;
        position = fullText.toLowerCase().indexOf(query, index);
      }

      setSearchMatches(matches);
      setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
    }, 300);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQuery, logs]);

  // 検索マッチへジャンプ
  const jumpToMatch = useCallback(
    (matchIndex: number) => {
      if (
        searchMatches.length === 0 ||
        matchIndex < 0 ||
        matchIndex >= searchMatches.length
      )
        return;

      setCurrentMatchIndex(matchIndex);

      const fullText = logs.join('');
      const targetPosition = searchMatches[matchIndex];
      const textBefore = fullText.substring(0, targetPosition);
      const lineNumber = textBefore.split('\n').length;

      if (logContainerRef.current) {
        const estimatedLineHeight = 20;
        const scrollPosition = Math.max(
          0,
          (lineNumber - 3) * estimatedLineHeight,
        );
        logContainerRef.current.scrollTop = scrollPosition;
        setAutoScroll(false);
      }
    },
    [searchMatches, logs],
  );

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    jumpToMatch(nextIndex);
  }, [currentMatchIndex, searchMatches.length, jumpToMatch]);

  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prevIndex =
      (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    jumpToMatch(prevIndex);
  }, [currentMatchIndex, searchMatches.length, jumpToMatch]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchQuery('');
        searchInputRef.current?.blur();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          goToPreviousMatch();
        } else {
          goToNextMatch();
        }
      }
    },
    [goToNextMatch, goToPreviousMatch],
  );

  const scrollToBottom = useCallback(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const clearSearchQuery = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  const handleSearchQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  const handleCopyLogs = useCallback(() => {
    navigator.clipboard.writeText(logs.join(''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [logs]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // テキストをハイライト表示するヘルパー関数
  const highlightText = useCallback(
    (text: string, query: string): React.ReactNode => {
      if (!query.trim()) return text;

      const parts = text.split(
        new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
      );

      return parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
          return (
            <mark
              key={i}
              className="bg-yellow-600/50 text-yellow-200 rounded px-0.5"
            >
              {part}
            </mark>
          );
        }
        return part;
      });
    },
    [],
  );

  // ログテキストをメモ化
  const logContent = useMemo(() => {
    if (logs.length === 0) {
      return null;
    }
    return logs.map((log, i) => (
      <span
        key={i}
        className={
          log.includes('[エラー]')
            ? 'text-red-400'
            : log.includes('[エージェント]')
              ? 'text-emerald-400 font-semibold'
              : log.includes('[実行開始]') ||
                  log.includes('[継続]') ||
                  log.includes('[完了]')
                ? 'text-blue-400'
                : /^\[.+?\]/.test(log.trimStart())
                  ? 'text-cyan-400'
                  : ''
        }
      >
        {searchQuery ? highlightText(log, searchQuery) : log}
      </span>
    ));
  }, [logs, searchQuery, highlightText]);

  // ステータスバッジの内容をメモ化
  const statusBadge = useMemo(() => {
    if (isRunning || status === 'running') {
      return (
        <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
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
          エラー
        </span>
      );
    }
    return null;
  }, [isRunning, status]);

  // 折りたたみ時は何も表示しない
  if (collapsible && !isExpanded && logs.length > 0) {
    return (
      <button
        onClick={toggleExpanded}
        className={`w-full px-4 py-2 flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors ${className}`}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-zinc-200">実行ログ</span>
          {statusBadge}
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-400" />
      </button>
    );
  }

  // ログがない場合は何も表示しない
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
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 rounded-t-lg border-b border-zinc-700">
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
          <div className="flex items-center gap-2">
            {/* 検索バー */}
            <div className="relative flex items-center gap-1">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchQueryChange}
                  onKeyDown={handleSearchKeyDown}
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
                    onClick={goToPreviousMatch}
                    disabled={searchMatches.length === 0}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="前の結果 (Shift+Enter)"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={goToNextMatch}
                    disabled={searchMatches.length === 0}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="次の結果 (Enter)"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={clearSearchQuery}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
                    title="クリア"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
            <div className="w-px h-4 bg-zinc-600" />
            {/* 自動スクロールボタン */}
            <button
              onClick={scrollToBottom}
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
              onClick={toggleFullscreen}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
              title={isFullscreen ? '縮小' : '拡大'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
            {collapsible && (
              <button
                onClick={toggleExpanded}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
                title="折りたたむ"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        onMouseDown={handleScrollStart}
        onMouseUp={handleScrollEnd}
        onTouchStart={handleScrollStart}
        onTouchEnd={handleScrollEnd}
        className={`bg-zinc-900 overflow-auto font-mono text-sm ${
          isFullscreen ? 'flex-1' : ''
        } ${showHeader ? 'rounded-b-lg' : 'rounded-lg'}`}
        style={{ height: isFullscreen ? undefined : maxHeight }}
      >
        <pre className="p-4 text-zinc-300 whitespace-pre-wrap wrap-break-words">
          {logContent || (
            <span className="text-zinc-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              実行ログを取得中...
            </span>
          )}
          {(isRunning || status === 'running') && logs.length > 0 && (
            <span className="inline-flex w-2 h-4 bg-green-400 ml-1 animate-pulse" />
          )}
        </pre>
      </div>
    </div>
  );
};

export default ExecutionLogViewer;

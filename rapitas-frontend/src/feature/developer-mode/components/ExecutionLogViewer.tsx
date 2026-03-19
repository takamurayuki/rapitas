'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
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
  Eye,
  Code,
  FileEdit,
  TestTube,
} from 'lucide-react';
import {
  transformLogsToSimple,
  detectCurrentPhase,
  generateExecutionSummary,
} from '../utils/log-message-transformer';
import type { ExecutionSummary } from '../utils/log-message-transformer';
import { SimpleLogEntryList } from './SimpleLogEntry';
import { WorkflowProgressBar } from './WorkflowProgressBar';

export type ExecutionLogStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExecutionLogViewMode = 'simple' | 'detailed';

export type ExecutionLogViewerProps = {
  /** Array of execution log lines */
  logs: string[];
  /** Execution status */
  status: ExecutionLogStatus;
  /** SSE connection state */
  isConnected?: boolean;
  /** Whether running */
  isRunning?: boolean;
  /** Whether to expand on initial display */
  defaultExpanded?: boolean;
  /** Whether to start in fullscreen mode */
  defaultFullscreen?: boolean;
  /** Default view mode */
  defaultViewMode?: ExecutionLogViewMode;
  /** Custom class name */
  className?: string;
  /** Whether collapsible */
  collapsible?: boolean;
  /** Whether to show header */
  showHeader?: boolean;
  /** Max log height in pixels */
  maxHeight?: number;
};

/**
 * Determine if a string is a file path
 */
function isFilePath(value: string): boolean {
  return (
    /^[a-zA-Z]?:?[/\\]/.test(value) ||
    /\.(ts|tsx|js|jsx|json|md|css|prisma)$/.test(value)
  );
}

/**
 * Format nested objects with indentation
 */
function formatNestedValue(value: unknown, indent: number = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') {
    const str = String(value);
    if (isFilePath(str)) return str; // Keep file paths as-is
    return str;
  }

  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== null && v !== undefined,
  );
  if (entries.length === 0) return '{}';
  if (entries.length <= 2 && !entries.some(([, v]) => typeof v === 'object')) {
    // Display small objects inline
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  const prefix = '  '.repeat(indent + 1);
  const lines = entries.map(([k, v]) => {
    if (typeof v === 'object' && v !== null) {
      return `${prefix}${k}: ${formatNestedValue(v, indent + 1)}`;
    }
    return `${prefix}${k}: ${v}`;
  });
  return `\n${lines.join('\n')}`;
}

/**
 * Detect and format JSON portions within a log string
 */
export function formatLogLine(log: string): {
  formatted: string;
  hasJson: boolean;
  isError?: boolean;
  isPhaseTransition?: boolean;
  filePaths?: string[];
} {
  // Detect workflow phase transitions
  const phaseMatch = log.match(
    /\[(research|plan|implement|verify|draft|plan_created|plan_approved|in_progress|completed)\]/i,
  );
  if (phaseMatch) {
    return { formatted: log, hasJson: false, isPhaseTransition: true };
  }

  // Check for JSON strings ({...} pattern)
  const jsonMatch = log.match(/^(.*?)(\{[\s\S]*\})(.*)$/);
  if (!jsonMatch) return { formatted: log, hasJson: false };

  const [, prefix, jsonStr, suffix] = jsonMatch;
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) {
      return { formatted: log, hasJson: false };
    }

    const obj = parsed as Record<string, unknown>;
    const parts: string[] = [];
    const filePaths: string[] = [];
    const isError = !!obj.error;

    // Display frequently used fields first
    const priorityKeys = [
      'message',
      'msg',
      'status',
      'type',
      'error',
      'taskId',
      'agentId',
    ];
    for (const key of priorityKeys) {
      if (key in obj && obj[key] !== null && obj[key] !== undefined) {
        const val = obj[key];
        if (typeof val === 'object') {
          parts.push(`${key}: ${formatNestedValue(val)}`);
        } else {
          const strVal = String(val);
          if (isFilePath(strVal)) filePaths.push(strVal);
          parts.push(`${key}: ${strVal}`);
        }
      }
    }

    // Remaining fields (with nesting support)
    const skipKeys = new Set([...priorityKeys, 'timestamp', 'level']);
    for (const [key, value] of Object.entries(obj)) {
      if (skipKeys.has(key) || value === null || value === undefined) continue;
      if (typeof value === 'object') {
        parts.push(`${key}: ${formatNestedValue(value)}`);
      } else {
        const strVal = String(value);
        if (isFilePath(strVal)) filePaths.push(strVal);
        parts.push(`${key}: ${strVal}`);
      }
    }

    const formattedJson = parts.join(' | ');
    return {
      formatted: `${prefix}${formattedJson}${suffix}`.trim(),
      hasJson: true,
      isError,
      filePaths: filePaths.length > 0 ? filePaths : undefined,
    };
  } catch {
    return { formatted: log, hasJson: false };
  }
}

// Log entry component (memoized)
const LogEntry = memo<{
  log: string;
  index: number;
  isNewEntry: boolean;
  searchQuery: string;
  highlightText: (text: string, query: string) => React.ReactNode;
}>(({ log, index, isNewEntry, searchQuery, highlightText }) => {
  const { formatted, hasJson, isError, isPhaseTransition, filePaths } =
    formatLogLine(log);

  // Emphasize error messages with red background block
  if (isError) {
    return (
      <span
        key={index}
        className={`block px-2 py-1 my-0.5 bg-red-950/50 border-l-2 border-red-500 text-red-400 ${isNewEntry ? 'log-entry-new' : ''}`}
        style={{
          animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined,
        }}
      >
        {searchQuery ? highlightText(formatted, searchQuery) : formatted}
      </span>
    );
  }

  // Special styling for phase transitions
  if (isPhaseTransition) {
    return (
      <span
        key={index}
        className={`block px-2 py-0.5 my-0.5 bg-indigo-950/30 border-l-2 border-indigo-500 text-indigo-300 font-medium ${isNewEntry ? 'log-entry-new' : ''}`}
        style={{
          animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined,
        }}
      >
        {searchQuery ? highlightText(formatted, searchQuery) : formatted}
      </span>
    );
  }

  const className = [
    log.includes('[Error]')
      ? 'text-red-400'
      : log.includes('[エージェント]')
        ? 'text-emerald-400 font-semibold'
        : log.includes('[実行開始]') ||
            log.includes('[継続]') ||
            log.includes('[完了]') ||
            log.includes('フェーズ完了]')
          ? 'text-blue-400'
          : /^\[.+?\]/.test(log.trimStart())
            ? 'text-cyan-400'
            : hasJson
              ? 'text-amber-300/90'
              : '',
    isNewEntry ? 'log-entry-new' : '',
    filePaths ? 'file-path-line' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Display file paths with monospace + color coding
  let content: React.ReactNode = searchQuery
    ? highlightText(formatted, searchQuery)
    : formatted;
  if (filePaths && !searchQuery) {
    let result = formatted;
    for (const fp of filePaths) {
      result = result.replace(fp, `\x00FP_START\x00${fp}\x00FP_END\x00`);
    }
    const segments = result.split(/\x00(FP_START|FP_END)\x00/);
    let inFilePath = false;
    content = segments.map((seg, i) => {
      if (seg === 'FP_START') {
        inFilePath = true;
        return null;
      }
      if (seg === 'FP_END') {
        inFilePath = false;
        return null;
      }
      if (inFilePath) {
        return (
          <span key={i} className="text-cyan-300 font-mono">
            {seg}
          </span>
        );
      }
      return seg;
    });
  }

  return (
    <span
      key={index}
      className={className}
      style={{
        display: 'block',
        animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined,
      }}
    >
      {content}
    </span>
  );
});

LogEntry.displayName = 'LogEntry';

/**
 * Completion summary card shown at the bottom of simple mode logs.
 * Icon-only, no emoji.
 */
const ExecutionSummaryCard: React.FC<{
  summary: ExecutionSummary;
  status: ExecutionLogStatus;
}> = ({ summary, status }) => {
  const isSuccess = status === 'completed';
  const totalFiles = summary.filesEdited.length + summary.filesCreated.length;

  return (
    <div
      className={`mt-4 rounded-lg border p-4 ${
        isSuccess
          ? 'border-green-500/40 bg-green-950/20'
          : 'border-red-500/40 bg-red-950/20'
      }`}
      style={{ animation: 'fadeInSlide 0.3s ease-out' }}
    >
      <div
        className={`flex items-center gap-2 text-sm font-semibold mb-3 ${
          isSuccess ? 'text-green-300' : 'text-red-300'
        }`}
      >
        {isSuccess ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <AlertCircle className="w-4 h-4" />
        )}
        {isSuccess ? '完了しました' : '実行に失敗しました'}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {totalFiles > 0 && (
          <div className="flex items-center gap-2 text-zinc-300">
            <FileEdit className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">変更:</span>
            <span className="font-medium">{totalFiles}件</span>
          </div>
        )}
        {summary.testsRun > 0 && (
          <div className="flex items-center gap-2 text-zinc-300">
            <TestTube className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">テスト:</span>
            <span className="font-medium">
              {summary.testsPassed > 0 && (
                <span className="text-green-400">
                  {summary.testsPassed}成功
                </span>
              )}
              {summary.testsFailed > 0 && (
                <span className="text-red-400 ml-1">
                  {summary.testsFailed}失敗
                </span>
              )}
            </span>
          </div>
        )}
        {summary.commits > 0 && (
          <div className="flex items-center gap-2 text-zinc-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">コミット:</span>
            <span className="font-medium">{summary.commits}件</span>
          </div>
        )}
        {summary.durationSeconds !== undefined && (
          <div className="flex items-center gap-2 text-zinc-300">
            <Square className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">所要時間:</span>
            <span className="font-medium">
              {summary.durationSeconds >= 60
                ? `${Math.floor(summary.durationSeconds / 60)}分${Math.round(summary.durationSeconds % 60)}秒`
                : `${Math.round(summary.durationSeconds)}秒`}
            </span>
          </div>
        )}
        <div className="col-span-2 flex items-center gap-2 text-zinc-300">
          <span className="text-zinc-500">課題:</span>
          <span className="font-medium">
            {summary.errors.length > 0
              ? summary.errors.map((e, i) => (
                  <span key={i} className="text-red-400">
                    {e}
                    {i < summary.errors.length - 1 ? ', ' : ''}
                  </span>
                ))
              : 'なし'}
          </span>
        </div>
      </div>
      {(summary.filesEdited.length > 0 || summary.filesCreated.length > 0) && (
        <details className="mt-3">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
            変更ファイル一覧
          </summary>
          <div className="mt-2 text-xs text-zinc-400 font-mono space-y-0.5 pl-2 border-l border-zinc-700">
            {summary.filesCreated.map((f) => (
              <div key={f} className="text-green-400">
                + {f}
              </div>
            ))}
            {summary.filesEdited.map((f) => (
              <div key={f} className="text-amber-400">
                ~ {f}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

/**
 * ExecutionLogViewer - AI agent execution log viewer component
 *
 * Standalone execution log viewer independent of status cards.
 * Provides search, auto-scroll, and fullscreen mode.
 */
/**
 * Displays execution logs with advanced features such as auto-scroll, search, copy, fullscreen, and view mode toggling.
 *
 * The `ExecutionLogViewer` component provides a user interface for viewing and interacting with execution logs.
 * It supports both "simple" and "detailed" view modes, real-time streaming indication, search with navigation,
 * auto-scroll to the latest logs, copying logs to clipboard, fullscreen mode, and collapsible UI.
 *
 * @param logs - Array of log strings to display.
 * @param status - Current execution status ('running', 'completed', 'failed', 'cancelled', etc.).
 * @param isConnected - Indicates if real-time streaming is active.
 * @param isRunning - Indicates if the execution is currently running.
 * @param defaultExpanded - Whether the log viewer is expanded by default.
 * @param defaultFullscreen - Whether the log viewer starts in fullscreen mode.
 * @param defaultViewMode - Initial view mode ('simple' or 'detailed').
 * @param className - Additional CSS classes for the root element.
 * @param collapsible - Whether the log viewer can be collapsed.
 * @param showHeader - Whether to display the header bar.
 * @param maxHeight - Maximum height of the log viewer (when not fullscreen).
 *
 * Features:
 * - Collapsible and fullscreen modes for flexible UI.
 * - Toggle between simple and detailed log views.
 * - Search functionality with match highlighting and navigation.
 * - Auto-scroll to the latest log entries, with manual override.
 * - Copy all logs to clipboard with feedback.
 * - Displays execution status and real-time streaming indicators.
 * - Progress bar and summary card for workflow executions.
 *
 * @example
 * ```tsx
 * <ExecutionLogViewer
 *   logs={logs}
 *   status="running"
 *   isConnected={true}
 *   isRunning={true}
 * />
 * ```
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
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isFullscreen, setIsFullscreen] = useState(defaultFullscreen);
  const [viewMode, setViewMode] =
    useState<ExecutionLogViewMode>(defaultViewMode);
  const [copied, setCopied] = useState(false);

  // Search feature state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const logContainerRef = useRef<HTMLDivElement>(null);
  // NOTE: Flag to control auto-scroll behavior
  const [autoScroll, setAutoScroll] = useState(true);
  const isUserScrollingRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const prevLogsLengthRef = useRef(0);
  // For log update buffering
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Monitor scroll position to control auto-scroll
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

  // Auto-scroll on log update (with buffering)
  useEffect(() => {
    if (logs.length > prevLogsLengthRef.current) {
      if (
        logContainerRef.current &&
        autoScroll &&
        !isUserScrollingRef.current
      ) {
        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }

        // Wait briefly then scroll once
        scrollTimerRef.current = setTimeout(() => {
          if (logContainerRef.current && autoScroll) {
            isAutoScrollingRef.current = true;

            logContainerRef.current.scrollTo({
              top: logContainerRef.current.scrollHeight,
              behavior: 'smooth',
            });

            setTimeout(() => {
              isAutoScrollingRef.current = false;
            }, 300);
          }
        }, 100); // 100ms buffering to batch rapid updates
      }
    }
    prevLogsLengthRef.current = logs.length;

    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, [logs.length, autoScroll]);

  // Search with debounce (log growth does not trigger search)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!searchQuery.trim()) {
      if (searchMatches.length > 0 || currentMatchIndex !== 0) {
        const timer = setTimeout(() => {
          setSearchMatches([]);
          setCurrentMatchIndex(0);
        }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }

    // Debounce to reduce search cost
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, logs]);

  // Jump to search match
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
        logContainerRef.current.scrollTo({
          top: scrollPosition,
          behavior: 'smooth',
        });
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
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
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

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'simple' ? 'detailed' : 'simple'));
  }, []);

  // Helper to highlight matching text
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

  // Track previous log count to identify new entries
  const [displayedLogsCount, setDisplayedLogsCount] = useState(0);

  useEffect(() => {
    if (logs.length > displayedLogsCount) {
      const timer = setTimeout(() => {
        setDisplayedLogsCount(logs.length);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [logs.length, displayedLogsCount]);

  // Transform logs for simple mode
  const simpleLogEntries = useMemo(() => {
    return transformLogsToSimple(logs);
  }, [logs]);

  // Detect current phase for progress bar
  const currentPhase = useMemo(() => {
    return detectCurrentPhase(logs);
  }, [logs]);

  // Generate execution summary (live during execution, final on completion)
  const executionSummary = useMemo(() => {
    if (logs.length === 0) return null;
    return generateExecutionSummary(logs);
  }, [logs]);


  // Memoize log content based on view mode
  const logContent = useMemo(() => {
    if (logs.length === 0) {
      return null;
    }

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

    // Detailed mode (original)
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

  // Status badge
  const statusBadge = useMemo(() => {
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
  }, [isRunning, status]);

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
            {/* 検索機能は詳細モードでのみ表示 */}
            {viewMode === 'detailed' && (
              <>
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
              </>
            )}
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
              onClick={toggleViewMode}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'simple'
                  ? 'text-blue-400 bg-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
              }`}
              title={
                viewMode === 'simple'
                  ? '詳細モードに切り替え'
                  : 'シンプルモードに切り替え'
              }
            >
              {viewMode === 'simple' ? (
                <Code className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
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

      {/* ワークフロー進捗バー（シンプルモードで表示） */}
      {viewMode === 'simple' && currentPhase && (
        <WorkflowProgressBar currentPhase={currentPhase} />
      )}

      {/* Live execution stats bar */}
      {viewMode === 'simple' &&
        executionSummary &&
        (isRunning || status === 'running') && (
          <div className="flex items-center gap-4 px-4 py-1.5 bg-zinc-800/60 border-b border-zinc-700/50 text-xs text-zinc-400">
            {(executionSummary.filesEdited.length > 0 ||
              executionSummary.filesCreated.length > 0) && (
              <span className="flex items-center gap-1">
                <FileEdit className="w-3 h-3" />
                {executionSummary.filesEdited.length +
                  executionSummary.filesCreated.length}
                ファイル
              </span>
            )}
            {executionSummary.testsRun > 0 && (
              <span className="flex items-center gap-1">
                <TestTube className="w-3 h-3" />
                {executionSummary.testsPassed > 0 && (
                  <span className="text-green-400">
                    {executionSummary.testsPassed}成功
                  </span>
                )}
                {executionSummary.testsFailed > 0 && (
                  <span className="text-red-400">
                    {executionSummary.testsFailed}失敗
                  </span>
                )}
              </span>
            )}
            {executionSummary.commits > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {executionSummary.commits}コミット
              </span>
            )}
            {executionSummary.errors.length > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <AlertCircle className="w-3 h-3" />
                {executionSummary.errors.length}エラー
              </span>
            )}
          </div>
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

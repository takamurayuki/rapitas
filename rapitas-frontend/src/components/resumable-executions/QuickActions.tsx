'use client';
// QuickActions

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  ChevronDown,
  ExternalLink,
  Loader2,
  Play,
  Zap,
  Loader2 as SpinnerIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ResumableExecution } from './types';

interface QuickActionsProps {
  executions: ResumableExecution[];
  resumingIds: Set<number>;
  hasRunning: boolean;
  runningCount: number;
  interruptedCount: number;
  onResume: (id: number) => void;
  onResumeAll: () => void;
  onExpand: () => void;
  formatTimeAgo: (dateString: string) => string;
}

/**
 * Renders the quick-action bar visible when the banner is collapsed.
 *
 * @param executions - Full list of current resumable executions.
 * @param resumingIds - Set of execution IDs with in-flight resume requests.
 * @param hasRunning - Whether any execution is currently running.
 * @param runningCount - Number of running executions.
 * @param interruptedCount - Number of interrupted (resumable) executions.
 * @param onResume - Resume a single execution by ID.
 * @param onResumeAll - Resume all interrupted executions.
 * @param onExpand - Expand the banner to show the full list.
 * @param formatTimeAgo - Relative-time formatter.
 */
export function QuickActions({
  executions,
  resumingIds,
  hasRunning,
  runningCount,
  interruptedCount,
  onResume,
  onResumeAll,
  onExpand,
  formatTimeAgo,
}: QuickActionsProps) {
  const t = useTranslations('banner');

  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);

  const colorClass = hasRunning
    ? 'bg-linear-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white'
    : 'bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white';

  const resumeAllBtnClass = hasRunning
    ? 'bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300'
    : 'bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-700 dark:text-amber-300';

  const detailsBorderClass = hasRunning
    ? 'border-blue-200/50 dark:border-blue-700/30'
    : 'border-amber-200/50 dark:border-amber-700/30';

  if (executions.length === 1) {
    return (
      <div className="px-3 pb-3 flex items-center gap-2">
        {executions[0].canResume ? (
          <button
            onClick={() => onResume(executions[0].id)}
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

        <button
          onClick={onExpand}
          className={`px-3 py-2 bg-white/60 dark:bg-zinc-800/60 hover:bg-white dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg text-xs font-medium transition-colors border ${detailsBorderClass}`}
        >
          {t('details')}
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pb-3 flex items-center gap-2">
      {/* Dropdown selector for multiple executions */}
      <div className="relative flex-1 min-w-0" ref={dropdownRef}>
        <button
          ref={dropdownButtonRef}
          onClick={(e) => {
            e.stopPropagation();
            if (!showDropdown && dropdownButtonRef.current) {
              const rect = dropdownButtonRef.current.getBoundingClientRect();
              setDropdownPosition({
                top: rect.bottom + 8,
                left: rect.left,
                width: rect.width,
              });
            }
            setShowDropdown((prev) => !prev);
          }}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${colorClass} ${showDropdown ? 'shadow-lg scale-[0.98]' : 'shadow-sm hover:shadow-md'}`}
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

        {showDropdown &&
          typeof window !== 'undefined' &&
          createPortal(
            <div
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
                        {(exec.status === 'running' || exec.status === 'waiting_for_input') && (
                          <span className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[9px] font-medium rounded">
                            <SpinnerIcon className="w-2.5 h-2.5 animate-spin" />
                          </span>
                        )}
                        {exec.status === 'interrupted' && (
                          <span className="shrink-0 px-1 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[9px] font-medium rounded">
                            {t('interruptedStatus')}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {formatTimeAgo(exec.startedAt || exec.createdAt)}
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

      {/* Resume all — only shown when multiple interrupted tasks exist */}
      {interruptedCount > 1 && (
        <button
          onClick={onResumeAll}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${resumeAllBtnClass}`}
        >
          <Play className="w-3.5 h-3.5" />
          {t('resumeAll')}
        </button>
      )}
    </div>
  );
}

'use client';
// SuggestionsHeader

import { ChevronDown, Sparkles, RefreshCw, X } from 'lucide-react';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';

type SuggestionsHeaderProps = {
  /** Whether AI suggestions have been loaded and are visible. */
  hasSuggestions: boolean;
  /** Count of visible (non-deleted) suggestions. */
  suggestionCount: number;
  /** Whether an AI fetch is in progress. */
  isAiLoading: boolean;
  /** Whether the suggestion list is currently expanded. */
  isExpanded: boolean;
  /** Whether the header chevron / expand behavior is active. */
  canExpand: boolean;
  onHeaderClick: () => void;
  onGenerate: () => void;
  onRefresh: () => void;
  onClear: () => void;
};

/**
 * Header section of the TaskSuggestions panel.
 *
 * @param props - See SuggestionsHeaderProps
 * @returns A clickable header row with context-aware action buttons.
 */
export function SuggestionsHeader({
  hasSuggestions,
  suggestionCount,
  isAiLoading,
  isExpanded,
  canExpand,
  onHeaderClick,
  onGenerate,
  onRefresh,
  onClear,
}: SuggestionsHeaderProps) {
  return (
    <div
      onClick={onHeaderClick}
      className={`flex items-center justify-between px-3 py-1.5 ${
        canExpand
          ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
          : ''
      } transition-all duration-200`}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-violet-500 dark:text-violet-400" />
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            AIタスク提案
          </span>
        </div>
        {hasSuggestions && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-semibold">
            {suggestionCount}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {/* Generate button — shown only when no suggestions exist */}
        {!isAiLoading && !hasSuggestions && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onGenerate();
            }}
            className="group flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all duration-200 bg-linear-to-r from-violet-500 to-indigo-500 text-white hover:from-violet-600 hover:to-indigo-600 shadow-sm hover:shadow-md transform hover:scale-105"
            title="AI提案を生成"
          >
            <Sparkles className="w-3 h-3 group-hover:rotate-12 transition-transform duration-200" />
            <span>提案を生成</span>
          </button>
        )}

        {/* Loading skeleton */}
        {isAiLoading && (
          <div className="flex items-center gap-1 px-2 py-0.5">
            <SkeletonBlock className="w-3 h-3 rounded" />
            <SkeletonBlock className="w-12 h-3 rounded" />
          </div>
        )}

        {/* Refresh / clear buttons — shown when suggestions exist */}
        {!isAiLoading && hasSuggestions && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-all duration-200"
              title="再生成"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 transition-all duration-200"
              title="クリア"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        )}

        {canExpand && (
          <div
            className={`transition-transform duration-200 text-zinc-400 dark:text-zinc-500 ${isExpanded ? 'rotate-180' : ''}`}
          >
            <ChevronDown className="w-3 h-3" />
          </div>
        )}
      </div>
    </div>
  );
}

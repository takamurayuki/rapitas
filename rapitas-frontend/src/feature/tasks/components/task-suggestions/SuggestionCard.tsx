'use client';
// SuggestionCard

import {
  Repeat,
  ArrowRight,
  Wrench,
  PlusCircle,
  X,
  BarChart3,
  CheckCircle2,
  Target,
} from 'lucide-react';

/** Shared shape for a task suggestion coming from the AI API. */
export type TaskSuggestion = {
  title: string;
  frequency: number;
  priority: string;
  estimatedHours: number | null;
  description: string | null;
  labelIds: number[];
  reason?: string | null;
  category?: 'recurring' | 'extension' | 'improvement' | 'new';
  completionCriteria?: string | null;
  measurableOutcome?: string | null;
  dependencies?: string | null;
  suggestedApproach?: string | null;
};

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  recurring: {
    label: '定期',
    icon: <Repeat className="w-2.5 h-2.5" />,
    color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
  },
  extension: {
    label: '発展',
    icon: <ArrowRight className="w-2.5 h-2.5" />,
    color: 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400',
  },
  improvement: {
    label: '改善',
    icon: <Wrench className="w-2.5 h-2.5" />,
    color: 'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400',
  },
  new: {
    label: '新規',
    icon: <PlusCircle className="w-2.5 h-2.5" />,
    color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400',
  },
};

type SuggestionCardProps = {
  suggestion: TaskSuggestion;
  onApply: () => void;
  onDismiss: () => void;
  onClick: () => void;
};

/**
 * Compact card for a single AI task suggestion.
 *
 * @param props - See SuggestionCardProps
 * @returns Card element with title, badges, and hover action buttons.
 */
export function SuggestionCard({ suggestion, onApply, onDismiss, onClick }: SuggestionCardProps) {
  return (
    <div className="group relative rounded-lg bg-white dark:bg-zinc-900/30 border border-zinc-200/60 dark:border-zinc-700/40 hover:border-violet-300 dark:hover:border-violet-500 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center gap-2 p-2">
        <div className="flex-1 min-w-0">
          <button type="button" onClick={onClick} className="w-full text-left group">
            <div className="flex items-center gap-1.5">
              {suggestion.category && (
                <span
                  className={`shrink-0 flex items-center gap-0.5 px-1 py-px rounded text-[8px] font-semibold ${
                    CATEGORY_CONFIG[suggestion.category]?.color ?? CATEGORY_CONFIG.new.color
                  }`}
                >
                  {CATEGORY_CONFIG[suggestion.category]?.icon}
                  <span className="hidden sm:inline">
                    {CATEGORY_CONFIG[suggestion.category]?.label}
                  </span>
                </span>
              )}

              <h4 className="font-medium text-xs text-zinc-800 dark:text-zinc-200 leading-tight flex-1 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                {suggestion.title}
              </h4>

              {suggestion.estimatedHours && (
                <span className="shrink-0 text-[9px] text-zinc-500 dark:text-zinc-400 font-medium">
                  {suggestion.estimatedHours}h
                </span>
              )}

              {(suggestion.priority === 'urgent' || suggestion.priority === 'high') && (
                <span className="shrink-0 w-1 h-1 rounded-full bg-rose-500 dark:bg-rose-400 animate-pulse" />
              )}
            </div>

            {/* Mini metadata indicators */}
            <div className="flex items-center gap-1 mt-0.5">
              {suggestion.measurableOutcome && (
                <BarChart3 className="w-2.5 h-2.5 text-violet-400" />
              )}
              {suggestion.completionCriteria && (
                <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
              )}
              {suggestion.dependencies && <Target className="w-2.5 h-2.5 text-amber-500" />}
            </div>
          </button>
        </div>

        {/* Action buttons (revealed on hover) */}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onApply();
            }}
            className="p-1 bg-linear-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded transition-all duration-200 hover:scale-110"
            title="作成"
          >
            <PlusCircle className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="p-1 text-zinc-400 hover:text-rose-500 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all duration-200"
            title="削除"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

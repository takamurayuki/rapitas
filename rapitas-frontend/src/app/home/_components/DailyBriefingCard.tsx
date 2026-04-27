'use client';
// DailyBriefingCard — AI-generated morning briefing shown at the top of the task list.
import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Lightbulb,
  TrendingUp,
  X,
  RefreshCw,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface PriorityTask {
  id: number;
  title: string;
  reason: string;
  estimatedMinutes: number;
}

interface Briefing {
  date: string;
  greeting: string;
  summary: string;
  priorityTasks: PriorityTask[];
  warnings: string[];
  insights: string[];
  ideaSuggestion: string | null;
  estimatedProductiveHours: number;
}

interface DailyBriefingCardProps {
  categoryId: number | null;
}

export function DailyBriefingCard({ categoryId }: DailyBriefingCardProps) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const fetchBriefing = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (categoryId) params.set('categoryId', String(categoryId));
      const res = await fetch(`${API_BASE_URL}/daily-briefing?${params}`);
      const data = (await res.json()) as {
        success: boolean;
        briefing?: Briefing;
        error?: string;
      };
      if (!data.success || !data.briefing)
        throw new Error(data.error ?? 'Failed');
      setBriefing(data.briefing);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'ブリーフィングの取得に失敗',
      );
    } finally {
      setIsLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    // NOTE: Auto-fetch on mount if not already loaded today.
    const cached = sessionStorage.getItem('daily-briefing-date');
    if (cached === new Date().toISOString().split('T')[0]) return;
    fetchBriefing().then(() => {
      sessionStorage.setItem(
        'daily-briefing-date',
        new Date().toISOString().split('T')[0],
      );
    });
  }, [fetchBriefing]);

  if (isDismissed || (!briefing && !isLoading && !error)) return null;

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-violet-50 to-purple-50 dark:border-indigo-800 dark:from-indigo-950/30 dark:via-violet-950/30 dark:to-purple-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 hover:opacity-80"
        >
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
            {briefing?.greeting ?? 'デイリーブリーフィング'}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-3 w-3 text-indigo-400" />
          ) : (
            <ChevronDown className="h-3 w-3 text-indigo-400" />
          )}
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchBriefing}
            disabled={isLoading}
            aria-label="更新"
            className="rounded p-1 text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            aria-label="閉じる"
            className="rounded p-1 text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-3 space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
              <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-300">
                AIがあなたの1日を分析中...
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}

          {briefing && !isLoading && (
            <>
              {/* Summary */}
              <p className="text-xs text-indigo-700 dark:text-indigo-300">
                {briefing.summary}
              </p>

              {/* Priority tasks */}
              {briefing.priorityTasks.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium text-indigo-500 uppercase tracking-wide">
                    今日やるべきタスク
                  </p>
                  {briefing.priorityTasks.map((task, i) => (
                    <a
                      key={task.id}
                      href={`/tasks/${task.id}`}
                      className="flex items-start gap-2 rounded-lg bg-white/60 px-3 py-2 text-xs hover:bg-white dark:bg-zinc-800/50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300 shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">
                          {task.title}
                        </span>
                        <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">
                          — {task.reason}
                        </span>
                      </div>
                      <span className="flex items-center gap-0.5 text-[10px] text-zinc-400 shrink-0">
                        <Clock className="h-2.5 w-2.5" />
                        {task.estimatedMinutes}分
                      </span>
                    </a>
                  ))}
                </div>
              )}

              {/* Warnings + Insights + Idea in a compact row */}
              <div className="flex flex-wrap gap-2">
                {briefing.warnings.map((w, i) => (
                  <span
                    key={`w${i}`}
                    className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  >
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {w}
                  </span>
                ))}
                {briefing.insights.map((ins, i) => (
                  <span
                    key={`i${i}`}
                    className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  >
                    <TrendingUp className="h-2.5 w-2.5" />
                    {ins}
                  </span>
                ))}
                {briefing.ideaSuggestion && (
                  <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    <Lightbulb className="h-2.5 w-2.5" />
                    {briefing.ideaSuggestion}
                  </span>
                )}
              </div>

              {/* Estimated productive hours */}
              <div className="flex justify-end">
                <span className="text-[10px] text-indigo-400">
                  推定稼働: {briefing.estimatedProductiveHours}h
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

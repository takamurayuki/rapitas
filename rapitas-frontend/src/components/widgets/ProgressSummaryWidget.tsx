'use client';

/**
 * ProgressSummaryWidget
 *
 * Displays an AI-generated progress summary on the dashboard.
 * Fetches data from /progress/summary API and shows highlights.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, TrendingUp, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

type ProgressSummary = {
  period: string;
  generatedAt: string;
  completedCount: number;
  totalHours: number;
  summary: string;
  highlights: string[];
  tasksById: Array<{ id: number; title: string; completedAt: string }>;
};

export function ProgressSummaryWidget() {
  const [data, setData] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/progress/summary?days=7`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setData(json.data);
      }
    } catch {
      // NOTE: Silently fail — widget is non-critical
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchSummary();
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 animate-pulse">
        <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48 mb-3" />
        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-full mb-2" />
        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4" />
      </div>
    );
  }

  if (!data || data.completedCount === 0) return null;

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            週間サマリー
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">
              {data.completedCount}件完了 · {data.totalHours}h
            </span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{data.summary}</p>

        {data.highlights.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {data.highlights.map((h, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400"
              >
                <TrendingUp className="w-3 h-3 mt-0.5 text-emerald-500 shrink-0" />
                <span>{h}</span>
              </div>
            ))}
          </div>
        )}

        {data.tasksById.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex items-center gap-1 text-xs text-violet-500 hover:text-violet-600 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? '閉じる' : `${data.tasksById.length}件のタスクを表示`}
          </button>
        )}

        {expanded && (
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {data.tasksById.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 py-1"
              >
                <span className="truncate flex-1">
                  #{t.id} {t.title}
                </span>
                <span className="shrink-0 ml-2 text-zinc-400">
                  {new Date(t.completedAt).toLocaleDateString('ja-JP', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

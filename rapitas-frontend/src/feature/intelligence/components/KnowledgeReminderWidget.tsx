'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BookOpen,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';
import { useKnowledgeReminders } from '../hooks/useIntelligence';

const categoryColors: Record<string, string> = {
  procedure: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pattern:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  insight:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  fact: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  preference:
    'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  general: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400',
};

export function KnowledgeReminderWidget() {
  const {
    summary,
    loading,
    fetchSummary,
    markAsReviewed,
    snooze,
    fetchContent,
  } = useKnowledgeReminders();
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(
    new Set(),
  );
  const [entryContents, setEntryContents] = useState<Map<number, string>>(
    new Map(),
  );
  const [loadingContent, setLoadingContent] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const toggleExpanded = useCallback(
    async (entryId: number) => {
      const newExpanded = new Set(expandedEntries);
      if (newExpanded.has(entryId)) {
        newExpanded.delete(entryId);
      } else {
        newExpanded.add(entryId);
        // Fetch content if not already loaded
        if (!entryContents.has(entryId)) {
          setLoadingContent((prev) => new Set(prev).add(entryId));
          const content = await fetchContent(entryId);
          setEntryContents((prev) => new Map(prev).set(entryId, content));
          setLoadingContent((prev) => {
            const newSet = new Set(prev);
            newSet.delete(entryId);
            return newSet;
          });
        }
      }
      setExpandedEntries(newExpanded);
    },
    [expandedEntries, entryContents, fetchContent],
  );

  const handleSnooze = useCallback(
    async (entryId: number) => {
      const success = await snooze(entryId, 24);
      if (success) {
        // Remove from expanded entries if it was expanded
        setExpandedEntries((prev) => {
          const newSet = new Set(prev);
          newSet.delete(entryId);
          return newSet;
        });
      }
    },
    [snooze],
  );

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const hasAtRisk = summary.atRiskCount > 0;

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-500" />
          ナレッジリマインド
        </h2>
        <button
          onClick={() => fetchSummary()}
          className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          title="更新"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center p-2 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
          <div
            className={`text-lg font-bold ${hasAtRisk ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-800 dark:text-zinc-200'}`}
          >
            {summary.atRiskCount}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            忘却リスク
          </div>
        </div>
        <div className="text-center p-2 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
          <div className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
            {summary.dormantCount}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            休眠中
          </div>
        </div>
        <div className="text-center p-2 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
          <div className="text-lg font-bold text-green-600 dark:text-green-400">
            {summary.recentlyReviewed}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            復習済み
          </div>
        </div>
      </div>

      {/* At-risk entries */}
      {summary.topAtRisk.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>復習が必要なナレッジ</span>
          </div>
          {summary.topAtRisk.map((entry) => {
            const isExpanded = expandedEntries.has(entry.id);
            const isLoadingThis = loadingContent.has(entry.id);
            const content = entryContents.get(entry.id);

            return (
              <div
                key={entry.id}
                className="rounded-lg bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30"
              >
                <div className="flex items-center gap-2 p-2">
                  {/* Expand toggle */}
                  <button
                    onClick={() => toggleExpanded(entry.id)}
                    className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors shrink-0"
                    title={isExpanded ? '閉じる' : '内容を表示'}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => toggleExpanded(entry.id)}
                      className="text-sm text-zinc-800 dark:text-zinc-200 truncate block w-full text-left hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    >
                      {entry.title}
                    </button>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${categoryColors[entry.category] || categoryColors.general}`}
                      >
                        {entry.category}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        記憶定着度: {Math.round(entry.decayScore * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Snooze button */}
                    <button
                      onClick={() => handleSnooze(entry.id)}
                      className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
                      title="後で復習（24時間スヌーズ）"
                    >
                      <Clock className="w-4 h-4" />
                    </button>
                    {/* Reviewed button */}
                    <button
                      onClick={() => markAsReviewed(entry.id)}
                      className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                      title="復習済みにする"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-amber-100 dark:border-amber-900/20">
                    {isLoadingThis ? (
                      <div className="animate-pulse h-12 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    ) : content ? (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                        {content}
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-400 italic">
                        コンテンツなし
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
          <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-green-500 opacity-50" />
          すべてのナレッジが安定しています
        </div>
      )}
    </div>
  );
}

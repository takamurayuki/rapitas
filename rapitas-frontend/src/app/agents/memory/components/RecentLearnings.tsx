'use client';
// RecentLearnings

import { Clock, Network, Sparkles, Target } from 'lucide-react';
import { NODE_TYPE_LABELS } from '../constants';
import type { MemoryOverview } from '../types';

interface RecentLearningsProps {
  memoryOverview: MemoryOverview;
  formatDate: (dateString: string) => string;
}

/**
 * Renders the latest patterns and knowledge nodes in a two-column layout.
 *
 * @param memoryOverview - Overview data containing recentHighlights arrays.
 * @param formatDate - Formats an ISO date string into a localised label.
 */
export function RecentLearnings({
  memoryOverview,
  formatDate,
}: RecentLearningsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Latest learning patterns */}
      <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-lg">
            <Sparkles className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
            最近の学習パターン
          </h3>
        </div>

        {memoryOverview.recentHighlights.latestPatterns.length > 0 ? (
          <div className="space-y-3">
            {memoryOverview.recentHighlights.latestPatterns
              .slice(0, 5)
              .map((pattern) => (
                <div
                  key={pattern.id}
                  className="p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg"
                >
                  <p className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2 mb-1">
                    {pattern.description}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      信頼度 {(pattern.confidence * 100).toFixed(0)}%
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(pattern.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
            パターンがまだありません
          </div>
        )}
      </div>

      {/* Latest knowledge nodes */}
      <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
            <Network className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
            最新のナレッジノード
          </h3>
        </div>

        {memoryOverview.recentHighlights.latestNodes.length > 0 ? (
          <div className="space-y-3">
            {memoryOverview.recentHighlights.latestNodes
              .slice(0, 5)
              .map((node) => (
                <div
                  key={node.id}
                  className="p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg flex items-center justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {node.label}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {NODE_TYPE_LABELS[node.nodeType] ?? node.nodeType}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                      w: {node.weight.toFixed(1)}
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {formatDate(node.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
            ノードがまだありません
          </div>
        )}
      </div>
    </div>
  );
}

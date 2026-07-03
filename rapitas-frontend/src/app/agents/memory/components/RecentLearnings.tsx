'use client';
// RecentLearnings

import { Clock, Network, Sparkles, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NODE_TYPE_KEYS } from '../constants';
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
export function RecentLearnings({ memoryOverview, formatDate }: RecentLearningsProps) {
  const t = useTranslations('agents.memory');
  const nodeTypeLabel = (nodeType: string) =>
    (NODE_TYPE_KEYS as readonly string[]).includes(nodeType)
      ? t(`nodeTypeLabels.${nodeType}`)
      : nodeType;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Latest learning patterns */}
      <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-lg">
            <Sparkles className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
            {t('recentLearnings.patternsTitle')}
          </h3>
        </div>

        {memoryOverview.recentHighlights.latestPatterns.length > 0 ? (
          <div className="space-y-3">
            {memoryOverview.recentHighlights.latestPatterns.slice(0, 5).map((pattern) => (
              <div key={pattern.id} className="p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                <p className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2 mb-1">
                  {pattern.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    {t('recentLearnings.confidenceLabel', {
                      percent: (pattern.confidence * 100).toFixed(0),
                    })}
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
            <p className="font-medium text-zinc-600 dark:text-zinc-300">
              {t('recentLearnings.emptyPatternsTitle')}
            </p>
            <p className="mt-1 text-xs">{t('recentLearnings.emptyPatternsHint')}</p>
          </div>
        )}
      </div>

      {/* Latest knowledge nodes */}
      <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
            <Network className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
            {t('recentLearnings.nodesTitle')}
          </h3>
        </div>

        {memoryOverview.recentHighlights.latestNodes.length > 0 ? (
          <div className="space-y-3">
            {memoryOverview.recentHighlights.latestNodes.slice(0, 5).map((node) => (
              <div
                key={node.id}
                className="p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {node.label}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {nodeTypeLabel(node.nodeType)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-xs px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full">
                    w: {node.weight.toFixed(1)}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-500">
                    {formatDate(node.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
            <p className="font-medium text-zinc-600 dark:text-zinc-300">
              {t('recentLearnings.emptyNodesTitle')}
            </p>
            <p className="mt-1 text-xs">{t('recentLearnings.emptyNodesHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

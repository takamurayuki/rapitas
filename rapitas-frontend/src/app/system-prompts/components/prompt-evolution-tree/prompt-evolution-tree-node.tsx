'use client';

/**
 * PromptEvolutionTreeNodeRow
 *
 * One row of the flattened lineage tree: summary line (indented by depth)
 * plus, when expanded, the 5-attribute detail panel (task type, effect +
 * significance, A/B status, applicable conditions, failure cases) and a
 * manual revalidate button.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { PromptEvolutionTreeNode } from './prompt-evolution-tree.types';
import { TREE_CONFIDENCE_BADGE_CLASS, formatPerformanceDelta } from './prompt-evolution-tree.utils';

const CONFIDENCE_KEY: Record<PromptEvolutionTreeNode['treeConfidence'], string> = {
  high: 'confidenceHigh',
  medium: 'confidenceMedium',
  low: 'confidenceLow',
};

interface PromptEvolutionTreeNodeRowProps {
  node: PromptEvolutionTreeNode;
  depth: number;
  revalidating: boolean;
  onRevalidate: (id: number) => Promise<{ ok: boolean; reason?: string; treeConfidence?: string }>;
}

export function PromptEvolutionTreeNodeRow({
  node,
  depth,
  revalidating,
  onRevalidate,
}: PromptEvolutionTreeNodeRowProps) {
  const t = useTranslations('prompts.promptEvolution.tree');
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const handleRevalidate = async () => {
    const result = await onRevalidate(node.id);
    if (result.ok) {
      showToast(t('revalidateSuccess', { confidence: result.treeConfidence ?? '' }), 'success');
    } else if (result.reason === 'not_applicable') {
      showToast(t('revalidateNotApplicable'), 'error');
    } else {
      showToast(t('revalidateFailed'), 'error');
    }
  };

  return (
    <div
      className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
      style={{ marginLeft: depth * 20 }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
        )}
        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
          #{node.id} {node.taskType ?? node.basePromptKey ?? ''}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{node.status}</span>
        <span
          className={`ml-auto shrink-0 rounded px-2 py-0.5 text-xs ${TREE_CONFIDENCE_BADGE_CLASS[node.treeConfidence]}`}
        >
          {t(CONFIDENCE_KEY[node.treeConfidence])}
        </span>
      </button>

      {expanded && (
        <div className="ml-6 mb-3 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <dt className="text-zinc-500 dark:text-zinc-400">{t('taskType')}</dt>
            <dd className="text-zinc-800 dark:text-zinc-200">
              {node.taskType ?? t('noConditionRecorded')}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">{t('effect')}</dt>
            <dd className="text-zinc-800 dark:text-zinc-200">
              {formatPerformanceDelta(node.performanceDelta)}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">{t('significance')}</dt>
            <dd className="text-zinc-800 dark:text-zinc-200">
              {node.significanceLevel ?? t('noConditionRecorded')}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">{t('cost')}</dt>
            <dd className="text-zinc-800 dark:text-zinc-200">
              {node.abComparisonRef ?? t('noConditionRecorded')}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">
              {node.abTested ? t('abTested') : t('abNotTested')}
            </dt>
            <dd />
          </dl>

          <p className="italic text-zinc-400 dark:text-zinc-500">{t('significanceNote')}</p>

          <div>
            <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">
              {t('applicableConditions')}
            </p>
            {node.applicableConditions.dayOfWeek === null &&
            node.applicableConditions.modelVersion === null &&
            node.applicableConditions.userSegment === null ? (
              <p className="text-zinc-400 dark:text-zinc-500">{t('noConditionRecorded')}</p>
            ) : (
              <ul className="list-inside list-disc text-zinc-700 dark:text-zinc-300">
                {node.applicableConditions.dayOfWeek && (
                  <li>
                    {t('dayOfWeek')}: {node.applicableConditions.dayOfWeek.join(', ')}
                  </li>
                )}
                {node.applicableConditions.modelVersion && (
                  <li>
                    {t('modelVersion')}: {node.applicableConditions.modelVersion.join(', ')}
                  </li>
                )}
                {node.applicableConditions.userSegment && (
                  <li>
                    {t('userSegment')}: {node.applicableConditions.userSegment.join(', ')}
                  </li>
                )}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">{t('failureCases')}</p>
            {node.failureCases.length === 0 ? (
              <p className="text-zinc-400 dark:text-zinc-500">{t('noFailureCases')}</p>
            ) : (
              <ul className="list-inside list-disc text-zinc-700 dark:text-zinc-300">
                {node.failureCases.map((fc, i) => (
                  <li key={i}>
                    {fc.occurredAt}: {fc.description}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {node.status === 'completed' && (
            <button
              type="button"
              onClick={handleRevalidate}
              disabled={revalidating}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${revalidating ? 'animate-spin' : ''}`} />
              {revalidating ? t('revalidating') : t('revalidate')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

'use client';
// PrMergeSection

import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, GitPullRequest, GitMerge, ExternalLink } from 'lucide-react';
import type { PrState } from './agent-execution-types';
import { Spinner } from '@/components/ui/spinner';

type Props = {
  /** Current PR workflow state. */
  prState: PrState;
  /** Reset PR state back to idle (for retry). */
  resetPrState: () => void;
  /** Create a PR for this task's branch. */
  onCreatePR: () => void;
  /** Approve and merge the open PR. */
  onApproveMerge: () => void;
};

/**
 * PR creation and merge controls displayed in the completed execution panel.
 *
 * @param props - See Props type
 */
export function PrMergeSection({ prState, resetPrState, onCreatePR, onApproveMerge }: Props) {
  const t = useTranslations('devMode.prMergeSection');
  return (
    <div className="px-6 py-4 border-t border-green-200 dark:border-green-800 bg-white/30 dark:bg-indigo-dark-900/20">
      <div className="flex items-center gap-2 mb-3">
        <GitPullRequest className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('heading')}</span>
      </div>

      {prState.status === 'idle' && (
        <button
          onClick={onCreatePR}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <GitPullRequest className="w-4 h-4" />
          {t('createPr')}
        </button>
      )}

      {prState.status === 'creating_pr' && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Spinner size="sm" />
          {t('creatingPr')}
        </div>
      )}

      {prState.status === 'pr_created' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            {t('prCreated', { number: prState.prNumber ?? 0 })}
            {prState.prUrl && (
              <a
                href={prState.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
              >
                {t('viewOnGithub')}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <button
            onClick={onApproveMerge}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <GitMerge className="w-4 h-4" />
            {t('approveMerge')}
          </button>
        </div>
      )}

      {prState.status === 'merging' && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Spinner size="sm" />
          {t('merging')}
        </div>
      )}

      {prState.status === 'merged' && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <GitMerge className="w-4 h-4" />
          {t('merged', { number: prState.prNumber ?? 0 })}
        </div>
      )}

      {prState.status === 'error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            {prState.error}
          </div>
          <button
            onClick={resetPrState}
            className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      )}
    </div>
  );
}

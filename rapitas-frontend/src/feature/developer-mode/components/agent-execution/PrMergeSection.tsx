/**
 * PrMergeSection
 *
 * Renders the PR creation and merge UI shown after a successful execution.
 * Extracted from ExecutionCompletedPanel to keep file sizes under 300 lines.
 */

'use client';

import React from 'react';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  GitPullRequest,
  GitMerge,
  ExternalLink,
} from 'lucide-react';
import type { PrState } from './agent-execution-types';

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
  return (
    <div className="px-6 py-4 border-t border-emerald-200 dark:border-emerald-800 bg-white/30 dark:bg-indigo-dark-900/20">
      <div className="flex items-center gap-2 mb-3">
        <GitPullRequest className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          PR & マージ
        </span>
      </div>

      {prState.status === 'idle' && (
        <button
          onClick={onCreatePR}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <GitPullRequest className="w-4 h-4" />
          PR作成
        </button>
      )}

      {prState.status === 'creating_pr' && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          PR作成中...
        </div>
      )}

      {prState.status === 'pr_created' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            PR #{prState.prNumber} 作成済み
            {prState.prUrl && (
              <a
                href={prState.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                GitHub で確認
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <button
            onClick={onApproveMerge}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <GitMerge className="w-4 h-4" />
            承認 & マージ
          </button>
        </div>
      )}

      {prState.status === 'merging' && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          マージ中...（ローカルのdevelopも更新されます）
        </div>
      )}

      {prState.status === 'merged' && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <GitMerge className="w-4 h-4" />
          PR #{prState.prNumber}{' '}
          がマージされました。ローカルのdevelopは最新です。
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
            リトライ
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * PRSidebar
 *
 * Right-side metadata panel for the pull request detail page.
 * Displays PR state, reviewer list, and change statistics.
 */

import { useTranslations } from 'next-intl';
import type { GitHubPullRequest, FileDiff } from '@/types';
import { getPRStatusIcon, getReviewIcon } from './PrUtils';

interface PRSidebarProps {
  pr: GitHubPullRequest;
  diff: FileDiff[];
}

/**
 * Renders the sidebar cards: status, reviews summary, and change stats.
 *
 * @param props.pr - Pull request data / プルリクエストデータ
 * @param props.diff - Array of file diffs used for stats / 統計に使うファイル差分配列
 */
export function PRSidebar({ pr, diff }: PRSidebarProps) {
  const t = useTranslations('github');

  const totalAdditions = diff.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = diff.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
          {t('status')}
        </h3>
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
            pr.state === 'open'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : pr.state === 'merged'
                ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}
        >
          {getPRStatusIcon(pr.state)}
          <span className="font-medium capitalize">{pr.state}</span>
        </div>
      </div>

      {/* Reviews summary */}
      {pr.reviews && pr.reviews.length > 0 && (
        <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
            {t('reviews')}
          </h3>
          <div className="space-y-2">
            {pr.reviews.map((review) => (
              <div key={review.id} className="flex items-center gap-2 text-sm">
                {getReviewIcon(review.state)}
                <span className="text-zinc-600 dark:text-zinc-400">
                  {review.authorLogin}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change statistics */}
      <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
          {t('changes')}
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">
              {t('fileCount')}
            </span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {diff.length}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">
              {t('additions')}
            </span>
            <span className="font-medium text-green-600 dark:text-green-400">
              +{totalAdditions}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">
              {t('deletions')}
            </span>
            <span className="font-medium text-red-600 dark:text-red-400">
              -{totalDeletions}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

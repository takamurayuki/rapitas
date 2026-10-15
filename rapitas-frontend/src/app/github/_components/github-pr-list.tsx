/**
 * GitHubPrList
 *
 * "Recent pull requests" section: up to five open PRs with state-colored badges.
 * Renders nothing when there are no PRs.
 */
'use client';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { GitPullRequest } from 'lucide-react';
import type { GitHubPullRequest } from '@/types';

/**
 * Render the recent-pull-requests section.
 *
 * @param props.pullRequests - Open PRs for the first integration. / 先頭連携のオープンPR。
 */
export function GitHubPrList({ pullRequests }: { pullRequests: GitHubPullRequest[] }) {
  const t = useTranslations('github');
  if (pullRequests.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('recentPR')}</h2>
        <Link
          href="/github/pull-requests"
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {t('viewAll')}
        </Link>
      </div>
      <div className="space-y-2">
        {pullRequests.slice(0, 5).map((pr) => (
          <Link
            key={pr.id}
            href={`/github/pull-requests/${pr.id}`}
            className="flex items-center gap-4 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors"
          >
            <GitPullRequest
              className={`w-5 h-5 ${
                pr.state === 'open'
                  ? 'text-green-500'
                  : pr.state === 'merged'
                    ? 'text-purple-500'
                    : 'text-red-500'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                #{pr.prNumber} {pr.title}
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {pr.authorLogin} • {pr.headBranch} → {pr.baseBranch}
              </p>
            </div>
            <span
              className={`px-2 py-1 text-xs font-medium rounded ${
                pr.state === 'open'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : pr.state === 'merged'
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}
            >
              {pr.state}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

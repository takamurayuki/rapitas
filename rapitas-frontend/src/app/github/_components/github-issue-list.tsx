/**
 * GitHubIssueList
 *
 * "Recent issues" section: up to five open issues with labels and state badges.
 * Renders nothing when there are no issues.
 */
'use client';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { CircleDot } from 'lucide-react';
import type { GitHubIssue } from '@/types';
import { getLabelsArray } from '@/utils/labels';

/**
 * Render the recent-issues section.
 *
 * @param props.issues - Open issues for the first integration. / 先頭連携のオープンIssue。
 */
export function GitHubIssueList({ issues }: { issues: GitHubIssue[] }) {
  const t = useTranslations('github');
  if (issues.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('recentIssue')}
        </h2>
        <Link
          href="/github/issues"
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {t('viewAll')}
        </Link>
      </div>
      <div className="space-y-2">
        {issues.slice(0, 5).map((issue) => (
          <Link
            key={issue.id}
            href={`/github/issues/${issue.id}`}
            className="flex items-center gap-4 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors"
          >
            <CircleDot
              className={`w-5 h-5 ${issue.state === 'open' ? 'text-green-500' : 'text-purple-500'}`}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                #{issue.issueNumber} {issue.title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {issue.authorLogin}
                </span>
                {getLabelsArray(issue.labels)
                  .slice(0, 3)
                  .map((label) => (
                    <span
                      key={label}
                      className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded"
                    >
                      {label}
                    </span>
                  ))}
              </div>
            </div>
            <span
              className={`px-2 py-1 text-xs font-medium rounded ${
                issue.state === 'open'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              }`}
            >
              {issue.state}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

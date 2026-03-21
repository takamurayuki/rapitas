'use client';

/**
 * PRHeader
 *
 * Header row for the pull request detail page.
 * Displays back navigation, PR status icon, title, branch info, and GitHub link.
 */

import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GitHubPullRequest } from '@/types';
import { getPRStatusIcon } from './PrUtils';

interface PRHeaderProps {
  pr: GitHubPullRequest;
}

/**
 * Renders the top header section of the pull request detail view.
 *
 * @param props.pr - The pull request data / プルリクエストデータ
 */
export function PRHeader({ pr }: PRHeaderProps) {
  const t = useTranslations('github');

  return (
    <div className="flex items-start gap-4 mb-6">
      <Link
        href="/github/pull-requests"
        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
      </Link>
      {getPRStatusIcon(pr.state)}
      <div className="flex-1">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {pr.title}
          <span className="ml-2 text-zinc-400 font-normal">#{pr.prNumber}</span>
        </h1>
        <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          <span>by {pr.authorLogin}</span>
          <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded">
            {pr.headBranch} → {pr.baseBranch}
          </span>
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            {t('openInGitHub')}
          </a>
        </div>
      </div>
    </div>
  );
}

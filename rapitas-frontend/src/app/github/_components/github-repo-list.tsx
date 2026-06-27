/**
 * GitHubRepoList
 *
 * The "linked repositories" section: an empty state when no repos are integrated,
 * otherwise a card grid with per-repo sync and PR/issue counts.
 */
'use client';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { GitBranch, GitPullRequest, CircleDot, RefreshCw, ExternalLink } from 'lucide-react';
import type { GitHubIntegration } from '@/types';

interface GitHubRepoListProps {
  integrations: GitHubIntegration[];
  /** Id of the integration currently syncing, or null. / 同期中の連携ID。なければnull。 */
  syncing: number | null;
  /** Trigger a sync for the given integration. / 指定連携の同期を実行。 */
  onSync: (id: number) => void;
  /** Open the add-integration modal. / 連携追加モーダルを開く。 */
  onAdd: () => void;
}

/** Single linked-repository card with sync action and PR/issue links. */
function RepoCard({
  integration,
  syncing,
  onSync,
}: {
  integration: GitHubIntegration;
  syncing: number | null;
  onSync: (id: number) => void;
}) {
  const t = useTranslations('github');
  return (
    <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
            {integration.ownerName}/{integration.repositoryName}
          </h3>
          <a
            href={integration.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            {t('openInGitHub')}
          </a>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSync(integration.id)}
            disabled={syncing === integration.id}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
            title={t('sync')}
          >
            <RefreshCw className={`w-4 h-4 ${syncing === integration.id ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <Link
          href={`/github/pull-requests?integrationId=${integration.id}`}
          className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          <GitPullRequest className="w-4 h-4" />
          <span>{integration._count?.pullRequests || 0} PR</span>
        </Link>
        <Link
          href={`/github/issues?integrationId=${integration.id}`}
          className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          <CircleDot className="w-4 h-4" />
          <span>{integration._count?.issues || 0} Issues</span>
        </Link>
      </div>
    </div>
  );
}

/**
 * Render the linked-repositories section.
 *
 * @param props - Integrations and sync/add handlers. / 連携一覧と同期/追加ハンドラ。
 */
export function GitHubRepoList({ integrations, syncing, onSync, onAdd }: GitHubRepoListProps) {
  const t = useTranslations('github');
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
        {t('linkedRepos')}
      </h2>
      {integrations.length === 0 ? (
        <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
          <GitBranch className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">{t('noLinkedRepos')}</p>
          <button
            onClick={onAdd}
            className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {t('addRepo')}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration) => (
            <RepoCard
              key={integration.id}
              integration={integration}
              syncing={syncing}
              onSync={onSync}
            />
          ))}
        </div>
      )}
    </div>
  );
}

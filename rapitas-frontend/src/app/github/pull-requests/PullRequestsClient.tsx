'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  GitPullRequest,
  MessageSquare,
  Eye,
  Filter,
  ArrowLeft,
  GitMerge,
  XCircle,
  FolderGit2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GitHubPullRequest, GitHubIntegration } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('PullRequestsClient');

/** PRs grouped under their repository for an at-a-glance, per-repo view. */
interface RepoGroup {
  integration: GitHubIntegration;
  prs: GitHubPullRequest[];
}

export default function PullRequestsClient() {
  const t = useTranslations('github');
  const searchParams = useSearchParams();
  const integrationId = searchParams.get('integrationId');

  const [groups, setGroups] = useState<RepoGroup[]>([]);
  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>(integrationId || '');
  const [stateFilter, setStateFilter] = useState<string>('open');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIntegrations();
  }, []);

  // Fetch PRs for the selected repo, or ALL repos when none is selected, then
  // group them by repository so each repo's PRs are shown under its own header.
  const fetchPRs = useCallback(async () => {
    const targets = selectedIntegration
      ? integrations.filter((i) => i.id.toString() === selectedIntegration)
      : integrations;
    if (targets.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        targets.map(async (integration) => {
          try {
            const res = await fetch(
              `${API_BASE_URL}/github/integrations/${integration.id}/pull-requests?state=${stateFilter}`,
            );
            const prs: GitHubPullRequest[] = res.ok ? await res.json() : [];
            return { integration, prs };
          } catch {
            return { integration, prs: [] as GitHubPullRequest[] };
          }
        }),
      );
      setGroups(results.filter((g) => g.prs.length > 0));
    } catch (error) {
      logger.error('Failed to fetch PRs:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedIntegration, stateFilter, integrations]);

  useEffect(() => {
    if (integrations.length > 0) fetchPRs();
  }, [fetchPRs, integrations.length]);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/github/integrations`);
      const data = res.ok ? await res.json() : [];
      setIntegrations(data);
      // When there are no integrations the PR fetch effect never runs, so clear
      // the loading state here — otherwise the skeleton would show forever.
      if (!Array.isArray(data) || data.length === 0) setLoading(false);
    } catch (error) {
      logger.error('Failed to fetch integrations:', error);
      setLoading(false);
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'open':
        return <GitPullRequest className="w-5 h-5 text-green-500" />;
      case 'merged':
        return <GitMerge className="w-5 h-5 text-purple-500" />;
      case 'closed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <GitPullRequest className="w-5 h-5 text-zinc-400" />;
    }
  };

  const getStateBadge = (state: string) => {
    const styles = {
      open: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      merged: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      closed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    };
    return styles[state as keyof typeof styles] || styles.open;
  };

  const totalPrs = groups.reduce((sum, g) => sum + g.prs.length, 0);

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/github"
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Pull Requests</h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">{t('prsSubtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-400" />
            <select
              value={selectedIntegration}
              onChange={(e) => setSelectedIntegration(e.target.value)}
              className="px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-400"
            >
              <option value="">すべてのリポジトリ</option>
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.ownerName}/{integration.repositoryName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
            {['open', 'closed', 'all'].map((state) => (
              <button
                key={state}
                onClick={() => setStateFilter(state)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  stateFilter === state
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                {state === 'open'
                  ? t('stateOpen')
                  : state === 'closed'
                    ? t('stateClosed')
                    : t('stateAll')}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-zinc-200 dark:bg-zinc-700 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : totalPrs === 0 ? (
          <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
            <GitPullRequest className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">
              {integrations.length === 0 ? t('selectRepositoryPrompt') : t('noPullRequests')}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <section key={group.integration.id}>
                {/* Repository header */}
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-200 dark:border-zinc-700">
                  <FolderGit2 className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    {group.integration.ownerName}/{group.integration.repositoryName}
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    {group.prs.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {group.prs.map((pr) => (
                    <Link
                      key={pr.id}
                      href={`/github/pull-requests/${pr.id}`}
                      className="block p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start gap-4">
                        {getStateIcon(pr.state)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {pr.title}
                            </h3>
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${getStateBadge(pr.state)}`}
                            >
                              {pr.state}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
                            <span>#{pr.prNumber}</span>
                            <span>by {pr.authorLogin}</span>
                            <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-700 px-2 py-0.5 rounded">
                              {pr.headBranch} → {pr.baseBranch}
                            </span>
                          </div>
                          {pr.body && (
                            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
                              {pr.body}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-zinc-400">
                          {pr._count?.reviews ? (
                            <div className="flex items-center gap-1" title={t('reviewCount')}>
                              <Eye className="w-4 h-4" />
                              <span>{pr._count.reviews}</span>
                            </div>
                          ) : null}
                          {pr._count?.comments ? (
                            <div className="flex items-center gap-1" title={t('commentCount')}>
                              <MessageSquare className="w-4 h-4" />
                              <span>{pr._count.comments}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

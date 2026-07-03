'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CircleDot, Filter, ArrowLeft, Loader2, ArrowRightCircle, Bug } from 'lucide-react';
import type { GitHubIssue, GitHubIntegration } from '@/types';
import { useTranslations } from 'next-intl';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import { getTaskDetailPath } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

const logger = createLogger('IssuesClient');

export default function IssuesPage() {
  const t = useTranslations('github');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const searchParams = useSearchParams();
  const integrationId = searchParams.get('integrationId');

  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>(integrationId || '');
  const [stateFilter, setStateFilter] = useState<string>('open');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<number | null>(null);

  // NOTE: uses the setState updater form so this never needs
  // `selectedIntegration` in its closure — keeps the callback stable ([]
  // deps) so the mount effect below fetches integrations exactly once.
  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/github/integrations`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data);
        setSelectedIntegration((prev) => (!prev && data.length > 0 ? data[0].id.toString() : prev));
      }
    } catch (error) {
      logger.error('Failed to fetch integrations:', error);
    }
  }, []);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/github/integrations/${selectedIntegration}/issues?state=${stateFilter}`,
      );
      if (res.ok) {
        setIssues(await res.json());
      }
    } catch (error) {
      logger.error('Failed to fetch issues:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedIntegration, stateFilter]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (selectedIntegration) {
      fetchIssues();
    }
  }, [selectedIntegration, stateFilter, fetchIssues]);

  const importAsConcern = async (issueId: number) => {
    setImporting(issueId);
    try {
      const res = await fetch(`${API_BASE_URL}/github/issues/${issueId}/create-concern`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchIssues();
      }
    } catch (error) {
      logger.error('Failed to import issue as concern:', error);
    } finally {
      setImporting(null);
    }
  };

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
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Issues</h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">{t('issuesSubtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-400" />
            <select
              value={selectedIntegration}
              onChange={(e) => setSelectedIntegration(e.target.value)}
              className="px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:border-indigo-400"
            >
              <option value="">{t('selectRepository')}</option>
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
        ) : issues.length === 0 ? (
          <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
            <CircleDot className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">
              {selectedIntegration ? t('noIssues') : t('selectRepositoryPrompt')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-4">
                  <CircleDot
                    className={`w-5 h-5 mt-0.5 ${
                      issue.state === 'open' ? 'text-green-500' : 'text-purple-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/github/issues/${issue.id}`}
                        className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                      >
                        {issue.title}
                      </Link>
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded ${
                          issue.state === 'open'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        }`}
                      >
                        {issue.state}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
                      <span>#{issue.issueNumber}</span>
                      <span>by {issue.authorLogin}</span>
                      <span>{new Date(issue.createdAt).toLocaleDateString(dateLocale)}</span>
                    </div>
                    {hasLabels(issue.labels) && (
                      <div className="flex items-center gap-2 mt-2">
                        {getLabelsArray(issue.labels).map((label) => (
                          <span
                            key={label}
                            className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                    {issue.body && (
                      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
                        {issue.body}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {issue.linkedTaskId && (
                      <Link
                        href={getTaskDetailPath(issue.linkedTaskId)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                      >
                        <ArrowRightCircle className="w-4 h-4" />
                        {t('viewTask')}
                      </Link>
                    )}
                    {/* Bridge: import the issue into the concern backlog */}
                    {issue.linkedConcernId ? (
                      <Link
                        href="/concerns"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                      >
                        <Bug className="w-4 h-4" />
                        {t('concernLinked')}
                      </Link>
                    ) : (
                      <button
                        onClick={() => importAsConcern(issue.id)}
                        disabled={importing === issue.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {importing === issue.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Bug className="w-4 h-4" />
                        )}
                        {t('importAsConcern')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

/**
 * ActionsClient
 *
 * CI/CD view for a connected repository: lists recent GitHub Actions workflow
 * runs (via the backend `gh run` API) and orchestrates per-run expansion. Each
 * run lazily loads its jobs/steps on first expand and only expands once that
 * load completes. Read-only; log viewing lives elsewhere.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, FolderGit2 } from 'lucide-react';
import type { GitHubIntegration } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { WorkflowRunItem } from './_components/WorkflowRunItem';
import type { WorkflowRun, RunDetail } from './_types/actions.types';

const logger = createLogger('ActionsClient');

export default function ActionsClient() {
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>('');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [details, setDetails] = useState<Map<number, RunDetail>>(new Map());
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch(`${API_BASE_URL}/github/integrations`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: GitHubIntegration[]) => {
        setIntegrations(data);
        if (data.length > 0) setSelectedIntegration(String(data[0].id));
      })
      .catch((err) => logger.error('Failed to fetch integrations:', err));
  }, []);

  const fetchRuns = useCallback(async () => {
    if (!selectedIntegration) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/github/integrations/${selectedIntegration}/runs`);
      if (res.ok) {
        const data = await res.json();
        setRuns(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      logger.error('Failed to fetch runs:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedIntegration]);

  useEffect(() => {
    if (selectedIntegration) fetchRuns();
  }, [selectedIntegration, fetchRuns]);

  /**
   * Toggle a run's expansion. On first expand the detail (jobs/steps) is fetched
   * first and the row expands ONLY after it resolves — so the chevron shows a
   * spinner meanwhile instead of opening an empty panel.
   */
  const toggleExpand = async (runId: number) => {
    if (expandedId === runId) {
      setExpandedId(null);
      return;
    }
    if (details.has(runId)) {
      setExpandedId(runId);
      return;
    }
    if (detailLoadingId === runId) return; // a fetch is already in flight
    setDetailLoadingId(runId);
    try {
      const res = await fetch(
        `${API_BASE_URL}/github/integrations/${selectedIntegration}/runs/${runId}`,
      );
      if (res.ok) {
        const detail = (await res.json()) as RunDetail | null;
        if (detail) {
          setDetails((prev) => new Map(prev).set(runId, detail));
          setExpandedId(runId); // expand only after the load completes
        }
      }
    } catch (err) {
      logger.error('Failed to fetch run detail:', err);
    } finally {
      setDetailLoadingId(null);
    }
  };

  const toggleJob = (jobId: number) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">CI/CD</h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            GitHub Actions の実行履歴
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedIntegration}
            onChange={(e) => setSelectedIntegration(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {integrations.map((it) => (
              <option key={it.id} value={it.id}>
                {it.ownerName}/{it.repositoryName}
              </option>
            ))}
          </select>
          <button
            onClick={fetchRuns}
            disabled={loading || !selectedIntegration}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            更新
          </button>
        </div>
      </div>

      {loading && runs.length === 0 ? (
        <div className="space-y-2 py-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {selectedIntegration ? (
            <>
              <p className="font-medium text-zinc-600 dark:text-zinc-300">
                このリポジトリにはまだワークフロー実行がありません
              </p>
              <p className="mt-1 text-xs">
                プッシュやプルリクエストでCIが走ると、ここに表示されます。
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-zinc-600 dark:text-zinc-300">
                連携済みのリポジトリがありません
              </p>
              <p className="mt-1 text-xs">
                リポジトリを連携すると、CIの実行状況をここで確認できます。
              </p>
              <Link
                href="/github"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                <FolderGit2 className="h-4 w-4" />
                リポジトリを連携
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <WorkflowRunItem
              key={run.databaseId}
              run={run}
              integrationId={selectedIntegration}
              detail={details.get(run.databaseId)}
              isExpanded={expandedId === run.databaseId}
              isLoadingDetail={detailLoadingId === run.databaseId}
              expandedJobs={expandedJobs}
              dateLocale={dateLocale}
              onToggle={() => toggleExpand(run.databaseId)}
              onToggleJob={toggleJob}
            />
          ))}
        </div>
      )}
    </div>
  );
}

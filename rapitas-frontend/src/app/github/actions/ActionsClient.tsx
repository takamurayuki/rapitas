'use client';

/**
 * ActionsClient
 *
 * CI/CD view for a connected repository: lists recent GitHub Actions workflow
 * runs (via the backend `gh run` API) and orchestrates per-run expansion. Each
 * run lazily loads its jobs/steps on first expand and only expands once that
 * load completes. Read-only; log viewing lives elsewhere.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { RefreshCw, FolderGit2, GitBranch, X, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GitHubIntegration } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { WorkflowRunItem } from './_components/WorkflowRunItem';
import type { WorkflowRun, RunDetail } from './_types/actions.types';

const logger = createLogger('ActionsClient');

/** One commit-ish unit: all workflow runs sharing a branch + display title. */
interface RunGroup {
  key: string;
  title: string;
  branch: string;
  runs: WorkflowRun[];
  latestCreatedAt: string;
}

/**
 * Group runs into meaningful units — a push triggers several workflows that
 * share headBranch + displayTitle (≈ the commit), so one card per commit
 * instead of a flat interleaved list (operator feedback).
 *
 * @param runs - Flat run list (newest first from the API) / 実行一覧
 * @returns Groups sorted by newest run / コミット単位のグループ
 */
function groupRuns(runs: WorkflowRun[]): RunGroup[] {
  const map = new Map<string, RunGroup>();
  for (const run of runs) {
    const key = `${run.headBranch}\u0000${run.displayTitle}`;
    const group = map.get(key);
    if (group) {
      group.runs.push(run);
      if (run.createdAt > group.latestCreatedAt) group.latestCreatedAt = run.createdAt;
    } else {
      map.set(key, {
        key,
        title: run.displayTitle,
        branch: run.headBranch,
        runs: [run],
        latestCreatedAt: run.createdAt,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
}

/** Aggregate a group's outcome: any running → pending, any failure → fail, else pass. */
function groupOutcome(runs: WorkflowRun[]): 'pending' | 'fail' | 'pass' {
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  if (runs.some((r) => r.conclusion !== 'success' && r.conclusion !== 'skipped')) return 'fail';
  return 'pass';
}

export default function ActionsClient() {
  const t = useTranslations('github');
  const tCommon = useTranslations('common');

  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>('');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [details, setDetails] = useState<Map<number, RunDetail>>(new Map());
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());
  // Deep-link filter (?branch=…&integration=…) from the task-detail CI badge.
  const [branchFilter, setBranchFilter] = useState<string | null>(null);

  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('branch');
    if (b) setBranchFilter(b);
  }, []);

  const clearBranchFilter = () => {
    setBranchFilter(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  useEffect(() => {
    fetch(`${API_BASE_URL}/github/integrations`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: GitHubIntegration[]) => {
        setIntegrations(data);
        // Deep link names a repository — honor it over the first-repo default
        // (a branch filter against the wrong repo showed "no runs"). Read the
        // URL directly here: state set in a sibling effect would be stale.
        const wanted = new URLSearchParams(window.location.search).get('integration');
        const fromLink = wanted && data.some((it) => String(it.id) === wanted) ? wanted : null;
        if (fromLink) setSelectedIntegration(fromLink);
        else if (data.length > 0) setSelectedIntegration(String(data[0].id));
      })
      .catch((err) => logger.error('Failed to fetch integrations:', err));
  }, []);

  const fetchRuns = useCallback(async () => {
    if (!selectedIntegration) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/github/integrations/${encodeURIComponent(selectedIntegration)}/runs`,
      );
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
        `${API_BASE_URL}/github/integrations/${encodeURIComponent(selectedIntegration)}/runs/${runId}`,
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

  const groups = useMemo(() => {
    const visible = branchFilter ? runs.filter((r) => r.headBranch === branchFilter) : runs;
    return groupRuns(visible);
  }, [runs, branchFilter]);

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
      {/* Wraps so the repository picker drops under the title on a phone. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">CI/CD</h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('actionsClient.subtitle')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={selectedIntegration}
            onChange={(e) => setSelectedIntegration(e.target.value)}
            className="min-w-0 max-w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100"
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
            {tCommon('update')}
          </button>
        </div>
      </div>

      {branchFilter && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 text-indigo-700 dark:text-indigo-300">
            <GitBranch className="h-3.5 w-3.5" />
            {branchFilter}
            <button
              type="button"
              onClick={clearBranchFilter}
              aria-label={t('actionsClient.clearFilter')}
              className="ml-1 rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-800/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('actionsClient.filteredByBranch')}
          </span>
        </div>
      )}

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
                {t('actionsClient.noRunsTitle')}
              </p>
              <p className="mt-1 text-xs">{t('actionsClient.noRunsHint')}</p>
            </>
          ) : (
            <>
              <p className="font-medium text-zinc-600 dark:text-zinc-300">
                {t('actionsClient.noIntegrationsTitle')}
              </p>
              <p className="mt-1 text-xs">{t('actionsClient.noIntegrationsHint')}</p>
              <Link
                href="/github"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                <FolderGit2 className="h-4 w-4" />
                {t('actionsClient.linkRepository')}
              </Link>
            </>
          )}
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('actionsClient.noRunsForBranch')}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const outcome = groupOutcome(group.runs);
            return (
              <section
                key={group.key}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden"
              >
                {/* Commit-unit header: one card per branch+commit-title push */}
                <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2">
                  {outcome === 'pending' ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />
                  ) : outcome === 'fail' ? (
                    <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  )}
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {group.title}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                    <GitBranch className="h-3 w-3" />
                    {group.branch}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {t('actionsClient.runCount', { count: group.runs.length })}
                  </span>
                </div>
                <div className="space-y-1 p-2">
                  {group.runs.map((run) => (
                    <WorkflowRunItem
                      key={run.databaseId}
                      run={run}
                      integrationId={selectedIntegration}
                      detail={details.get(run.databaseId)}
                      isExpanded={expandedId === run.databaseId}
                      isLoadingDetail={detailLoadingId === run.databaseId}
                      expandedJobs={expandedJobs}
                      onToggle={() => toggleExpand(run.databaseId)}
                      onToggleJob={toggleJob}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

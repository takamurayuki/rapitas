'use client';

/**
 * ActionsClient
 *
 * CI/CD view for a connected repository: lists recent GitHub Actions workflow
 * runs (via the backend `gh run` API), and lets you expand a run to see its
 * jobs/steps and fetch its logs (all / failed-only). Read-only.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  MinusCircle,
  CircleDot,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  ScrollText,
} from 'lucide-react';
import type { GitHubIntegration } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

const logger = createLogger('ActionsClient');

interface WorkflowRun {
  databaseId: number;
  number: number;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  workflowName: string;
  headBranch: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

interface RunStep {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
}

interface RunJob {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps: RunStep[];
}

interface RunDetail extends WorkflowRun {
  jobs: RunJob[];
}

/** Status/conclusion → icon. Running = spinner, otherwise the conclusion. */
function StatusIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status !== 'completed') {
    return status === 'queued' ? (
      <Clock className="h-4 w-4 text-zinc-400" />
    ) : (
      <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
    );
  }
  switch (conclusion) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'failure':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'cancelled':
      return <MinusCircle className="h-4 w-4 text-zinc-400" />;
    default:
      return <CircleDot className="h-4 w-4 text-zinc-400" />;
  }
}

export default function ActionsClient() {
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>('');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Map<number, RunDetail>>(new Map());
  const [logs, setLogs] = useState<Map<number, string>>(new Map());
  const [logLoadingId, setLogLoadingId] = useState<number | null>(null);

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

  const toggleExpand = async (runId: number) => {
    if (expandedId === runId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(runId);
    if (!details.has(runId)) {
      try {
        const res = await fetch(
          `${API_BASE_URL}/github/integrations/${selectedIntegration}/runs/${runId}`,
        );
        if (res.ok) {
          const detail = (await res.json()) as RunDetail | null;
          if (detail) setDetails((prev) => new Map(prev).set(runId, detail));
        }
      } catch (err) {
        logger.error('Failed to fetch run detail:', err);
      }
    }
  };

  const fetchLog = async (runId: number, failed: boolean) => {
    setLogLoadingId(runId);
    try {
      const res = await fetch(
        `${API_BASE_URL}/github/integrations/${selectedIntegration}/runs/${runId}/log?failed=${failed}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { log?: string };
        setLogs((prev) => new Map(prev).set(runId, data.log || '(ログがありません)'));
      }
    } catch (err) {
      logger.error('Failed to fetch run log:', err);
    } finally {
      setLogLoadingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">CI/CD</h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            GitHub Actions の実行履歴とログ
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
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {selectedIntegration ? 'ワークフロー実行がありません' : 'リポジトリ連携がありません'}
        </p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const detail = details.get(run.databaseId);
            const log = logs.get(run.databaseId);
            const isExpanded = expandedId === run.databaseId;
            return (
              <div
                key={run.databaseId}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50"
              >
                <button
                  onClick={() => toggleExpand(run.databaseId)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <StatusIcon status={run.status} conclusion={run.conclusion} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {run.workflowName}
                      </span>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {run.displayTitle}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
                        {run.headBranch}
                      </span>
                      <span>{run.event}</span>
                      <span>{new Date(run.createdAt).toLocaleString(dateLocale)}</span>
                    </div>
                  </div>
                  <a
                    href={run.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                    title="GitHub で開く"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-100 dark:border-zinc-700/50 px-4 py-3 space-y-3">
                    {/* Jobs / steps */}
                    {detail ? (
                      detail.jobs.length === 0 ? (
                        <p className="text-xs text-zinc-400">ジョブ情報がありません</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.jobs.map((job) => (
                            <div key={job.databaseId}>
                              <div className="flex items-center gap-2">
                                <StatusIcon status={job.status} conclusion={job.conclusion} />
                                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                                  {job.name}
                                </span>
                              </div>
                              <div className="ml-6 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                {job.steps.map((step) => (
                                  <span
                                    key={step.number}
                                    className={`text-[11px] ${
                                      step.conclusion === 'failure'
                                        ? 'text-red-500'
                                        : 'text-zinc-400'
                                    }`}
                                  >
                                    {step.conclusion === 'failure' ? '✗' : '·'} {step.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                    )}

                    {/* Log controls */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fetchLog(run.databaseId, true)}
                        disabled={logLoadingId === run.databaseId}
                        className="flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <ScrollText className="h-3 w-3" />
                        失敗ログ
                      </button>
                      <button
                        onClick={() => fetchLog(run.databaseId, false)}
                        disabled={logLoadingId === run.databaseId}
                        className="flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <ScrollText className="h-3 w-3" />
                        全ログ
                      </button>
                      {logLoadingId === run.databaseId && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                      )}
                    </div>
                    {log !== undefined && (
                      <pre className="max-h-96 overflow-auto rounded bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-100">
                        {log}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

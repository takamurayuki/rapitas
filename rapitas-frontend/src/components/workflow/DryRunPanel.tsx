/**
 * DryRunPanel
 *
 * Lets the user try the full verify gate + completion gate + adversarial jury
 * against the task's current worktree, WITHOUT triggering commit/PR/merge/
 * status transition (task #723). Also lists past dry-run reports and lets the
 * user check whether the base branch has moved since a given report (drift).
 * Not responsible for the verification logic itself — that lives entirely on
 * the backend (services/workflow/dry-run-orchestrator.ts).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { GitCompare, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { Button } from '@/components/ui/button';

// 180s: covers the jury's worst case (3 providers × up to 120s timeout each,
// run in parallel via Promise.all — see adversarial-diff-review.ts's
// jurorTimeoutMs doc) with headroom for the deterministic gate that runs first.
const DRY_RUN_FETCH_TIMEOUT_MS = 180_000;
const SKIPPED_OPERATION_CODES = [
  'commit',
  'push',
  'pr_creation',
  'merge',
  'worktree_cleanup',
  'status_transition',
  'notification',
] as const;

interface DryRunReport {
  ok: boolean;
  gate: { ok: boolean; summary: string };
  completionGate: { allow: boolean; reason: string };
  jury: { verdict: 'pass' | 'fail' | 'unknown'; severity: number; reasons: string[] };
  baseBranchSha: string | null;
  skippedOperations: string[];
  reportId: number;
}

interface DryRunHistoryEntry {
  id: number;
  createdAt: string;
  payload: { ok?: boolean };
}

interface DriftResult {
  driftDetected: boolean;
  storedSha?: string;
  currentSha?: string;
  commitsBehind?: number | null;
  note?: string;
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRY_RUN_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface DryRunPanelProps {
  taskId: number;
}

/**
 * Dry-run action button + result summary, plus a history accordion with
 * per-report drift checks.
 *
 * @param taskId - Task whose worktree to dry-run / 対象タスクのID
 * @returns The panel / パネル
 */
export default function DryRunPanel({ taskId }: DryRunPanelProps) {
  const t = useTranslations('workflow');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DryRunHistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drift, setDrift] = useState<Record<number, DriftResult | 'loading'>>({});

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchJson<{ success?: boolean; reports?: DryRunHistoryEntry[] }>(
        `${API_BASE_URL}/workflow/tasks/${taskId}/dry-run/history`,
      );
      if (data.success && data.reports) setHistory(data.reports);
    } catch {
      // Non-fatal — history simply doesn't show.
    }
  }, [taskId]);

  useEffect(() => {
    if (taskId) void loadHistory();
  }, [taskId, loadHistory]);

  const runDryRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const data = await fetchJson<DryRunReport & { success: boolean; error?: string }>(
        `${API_BASE_URL}/workflow/tasks/${taskId}/dry-run`,
        { method: 'POST' },
      );
      if (!data.success) {
        setError(data.error ?? t('dryRun.error'));
      } else {
        setResult(data);
        void loadHistory();
      }
    } catch {
      setError(t('dryRun.error'));
    } finally {
      setRunning(false);
    }
  };

  const checkDrift = async (reportId: number) => {
    setDrift((prev) => ({ ...prev, [reportId]: 'loading' }));
    try {
      const data = await fetchJson<{ success?: boolean } & DriftResult>(
        `${API_BASE_URL}/workflow/tasks/${taskId}/dry-run/${reportId}/drift`,
      );
      setDrift((prev) => ({ ...prev, [reportId]: data }));
    } catch {
      setDrift((prev) => ({ ...prev, [reportId]: { driftDetected: false, note: 'check_failed' } }));
    }
  };

  const juryLabel = (verdict: 'pass' | 'fail' | 'unknown') => t(`dryRun.juryVerdict.${verdict}`);

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('dryRun.title')}
          </p>
          <Button
            onClickAction={() => void runDryRun()}
            loading={running}
            disabled={running}
            icon={<GitCompare />}
            size="sm"
          >
            {running ? t('dryRun.running') : t('dryRun.button')}
          </Button>
        </div>

        {error && <p className="px-4 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {result && (
          <div className="px-4 py-3 text-sm space-y-2">
            <p className="font-medium text-zinc-800 dark:text-zinc-200">
              {result.ok ? t('dryRun.resultOk') : t('dryRun.resultNg')}
            </p>
            <ul className="space-y-1 text-zinc-600 dark:text-zinc-400">
              <li>
                {t('dryRun.gateLabel')}: {result.gate.ok ? t('dryRun.pass') : t('dryRun.fail')}
              </li>
              <li>
                {t('dryRun.completionGateLabel')}:{' '}
                {result.completionGate.allow ? t('dryRun.pass') : t('dryRun.fail')}
              </li>
              <li>
                {t('dryRun.juryLabel')}: {juryLabel(result.jury.verdict)}
              </li>
              <li>
                {result.baseBranchSha
                  ? t('dryRun.baseBranchSha', { sha: result.baseBranchSha.slice(0, 8) })
                  : t('dryRun.baseBranchShaUnavailable')}
              </li>
            </ul>
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {t('dryRun.skippedOperationsTitle')}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {SKIPPED_OPERATION_CODES.map((code) => (
                  <li
                    key={code}
                    className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-400"
                  >
                    {t(`dryRun.skippedOperations.${code}`)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="border-t border-zinc-100 dark:border-zinc-800">
          <p className="px-4 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('dryRun.historyTitle')}
          </p>
          {history.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-zinc-400 dark:text-zinc-500">
              {t('dryRun.historyEmpty')}
            </p>
          ) : (
            <ul className="pb-2">
              {history.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const driftState = drift[entry.id];
                return (
                  <li key={entry.id} className="px-4 py-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      {new Date(entry.createdAt).toLocaleString()} ·{' '}
                      {entry.payload.ok ? t('dryRun.pass') : t('dryRun.fail')}
                    </button>
                    {isExpanded && (
                      <div className="mt-1.5 ml-5">
                        <button
                          type="button"
                          onClick={() => void checkDrift(entry.id)}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {driftState === 'loading'
                            ? t('dryRun.driftChecking')
                            : t('dryRun.checkDrift')}
                        </button>
                        {driftState && driftState !== 'loading' && (
                          <div className="mt-1 flex items-start gap-1.5">
                            {driftState.driftDetected && (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                            )}
                            <p className="text-zinc-500 dark:text-zinc-400">
                              {driftState.driftDetected
                                ? t('dryRun.driftDetected', {
                                    count: driftState.commitsBehind ?? '?',
                                  })
                                : driftState.note
                                  ? t(`dryRun.driftNote.${driftState.note}`)
                                  : t('dryRun.driftNone')}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * CiStatusBadge
 *
 * Shows the linked PR's CI check status directly on the task, so the user
 * doesn't have to click through to GitHub to see whether it's safe to merge.
 * Renders nothing when the task has no linked PR yet. Reuses the same icon
 * meanings as the GitHub Actions dashboard's StatusIcon (pass=green check,
 * fail=red x, pending=spinning loader, unknown=gray dot).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Loader2, CircleDot } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

type CiStatus = 'no_pr' | 'no_checks' | 'pass' | 'fail' | 'pending' | 'unknown';

interface CiStatusResponse {
  status: CiStatus;
  prNumber?: number;
  prState?: string;
}

/** How often to re-check while the PR is still open. Matches AutoMergeWatcher's own tick. */
const POLL_INTERVAL_MS = 30_000;

const BADGE_META: Record<
  Exclude<CiStatus, 'no_pr'>,
  { icon: typeof CheckCircle2; className: string; labelKey: string; spin?: boolean }
> = {
  pass: {
    icon: CheckCircle2,
    className: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30',
    labelKey: 'passing',
  },
  fail: {
    icon: XCircle,
    className: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
    labelKey: 'failing',
  },
  pending: {
    icon: Loader2,
    className: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
    labelKey: 'pending',
    spin: true,
  },
  no_checks: {
    icon: CircleDot,
    className: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800',
    labelKey: 'noChecks',
  },
  unknown: {
    icon: CircleDot,
    className: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800',
    labelKey: 'unknown',
  },
};

/**
 * @param taskId - Task whose linked PR's CI status to show. / CI状態を表示する対象タスクID
 */
export default function CiStatusBadge({ taskId }: { taskId: number }) {
  const t = useTranslations('task.ciStatus');
  const router = useRouter();
  const [data, setData] = useState<CiStatusResponse | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/github/pull-requests/by-task/${taskId}/ci-status`);
      if (!res.ok) return;
      setData((await res.json()) as CiStatusResponse);
    } catch {
      /* transient network error — keep the last known status, retry next tick */
    }
  }, [taskId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Stop polling once the PR is resolved (merged/closed) — nothing left to
  // change. `data === null` (still loading) polls too, so the badge appears
  // as soon as a PR shows up without waiting a full interval.
  const isTerminal = data !== null && data.prState != null && data.prState !== 'open';
  useEffect(() => {
    if (isTerminal) return;
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus, isTerminal]);

  const handleClick = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/github/pull-requests/by-task/${taskId}`);
      if (!res.ok) return;
      const pr = (await res.json()) as { id?: number; headBranch?: string | null };
      // A CI badge should land on the CI view (operator feedback: linking to
      // the PR page reads as an inconsistency) — branch-filtered so only this
      // PR's runs show. PR page stays the fallback for old rows w/o headBranch.
      if (pr.headBranch) {
        router.push(`/github/actions?branch=${encodeURIComponent(pr.headBranch)}`);
      } else if (pr.id != null) {
        router.push(`/github/pull-requests/${pr.id}`);
      }
    } catch {
      /* not_synced/not_created — nothing to navigate to; badge stays as-is */
    }
  };

  if (!data || data.status === 'no_pr') return null;

  const { icon: Icon, className, labelKey, spin } = BADGE_META[data.status];

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${className}`}
      title={t('viewCiTooltip', { number: data.prNumber ?? 0 })}
    >
      <Icon className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" />
      {t(labelKey)}
      {data.prNumber != null && ` #${data.prNumber}`}
    </button>
  );
}

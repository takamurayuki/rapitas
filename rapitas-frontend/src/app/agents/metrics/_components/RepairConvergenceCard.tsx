'use client';
/**
 * RepairConvergenceCard
 *
 * Compact KPI bar surfacing the self-repair loop's convergence rate: of the
 * tasks that ever bounced through verify_repair/ci_repair, how many
 * eventually converged (completed) vs stayed blocked, and how many repair
 * iterations convergence typically takes. Data comes from
 * /agent-metrics/repair-convergence, which aggregates WorkflowTransition rows
 * — this card is the only place that number was previously visible (only via
 * a raw API call), so it turns an unqueryable metric into a glanceable one.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Repeat, Activity, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

interface RepairConvergenceStats {
  tasksEnteredRepairLoop: number;
  convergedCount: number;
  blockedCount: number;
  pendingCount: number;
  convergenceRate: number;
  averageIterationsToConvergence: number | null;
}

export function RepairConvergenceCard() {
  const t = useTranslations('agents');
  const [data, setData] = useState<RepairConvergenceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/agent-metrics/repair-convergence`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { success: boolean; data?: RepairConvergenceStats };
      })
      .then((v) => {
        if (!cancelled && v.success && v.data) setData(v.data);
      })
      .catch(() => {
        // Non-critical widget — leave the card absent on failure.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data || data.tasksEnteredRepairLoop === 0) return null;

  const avgIterationsLabel =
    data.averageIterationsToConvergence !== null
      ? data.averageIterationsToConvergence.toFixed(1)
      : '—';

  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {t('repairConvergence.title')}
      </h3>
      <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {(data.convergenceRate * 100).toFixed(0)}%
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('repairConvergence.convergenceRate')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <Repeat className="h-5 w-5 shrink-0 text-indigo-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {avgIterationsLabel}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('repairConvergence.avgIterations')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <Activity className="h-5 w-5 shrink-0 text-purple-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.tasksEnteredRepairLoop}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('repairConvergence.enteredLoop')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.blockedCount}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('repairConvergence.blocked')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

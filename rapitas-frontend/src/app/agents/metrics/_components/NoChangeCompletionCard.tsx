'use client';
/**
 * NoChangeCompletionCard
 *
 * Compact KPI bar splitting confirmed no-change-needed completions
 * (verify_no_change_confirmed / research_no_change_complete) into immediate
 * (zero verify_repair bounces before the completion) vs after-repair (one or
 * more bounces). The after-repair subset is higher review priority — a
 * completion reached only after repair back-and-forth is more likely to be a
 * false no-change verdict than one reached in a single pass. Data comes from
 * /agent-metrics/no-change-completions.
 */
import { useEffect, useState } from 'react';
import { CircleCheck, FastForward, FlagTriangleRight, GitCompareArrows } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

interface NoChangeCompletionStats {
  totalConfirmedNoChange: number;
  immediateCount: number;
  afterRepairCount: number;
  immediateRate: number;
}

export function NoChangeCompletionCard() {
  const t = useTranslations('agents');
  const [data, setData] = useState<NoChangeCompletionStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/agent-metrics/no-change-completions`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { success: boolean; data?: NoChangeCompletionStats };
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

  if (loading || !data || data.totalConfirmedNoChange === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {t('noChangeCompletions.title')}
      </h3>
      <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <CircleCheck className="h-5 w-5 shrink-0 text-green-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {(data.immediateRate * 100).toFixed(0)}%
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('noChangeCompletions.immediateRate')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <FastForward className="h-5 w-5 shrink-0 text-indigo-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.immediateCount}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('noChangeCompletions.immediate')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <FlagTriangleRight className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.afterRepairCount}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('noChangeCompletions.afterRepair')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <GitCompareArrows className="h-5 w-5 shrink-0 text-purple-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.totalConfirmedNoChange}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('noChangeCompletions.total')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';
/**
 * CompletionDiffCard
 *
 * Compact KPI bar surfacing whether completed tasks actually landed a code
 * diff on their branch: the zero-diff completion rate plus the has_diff /
 * zero_diff / unknown counts. Data comes from
 * /agent-metrics/completion-diff, which joins Task.completedAt with the
 * latest auto_commit_created ActivityLog row per task — making "the task
 * completed but changed nothing" visible instead of buried in git history.
 */
import { useEffect, useState } from 'react';
import { FileX2, FileDiff, CircleSlash, HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

interface CompletionDiffStats {
  totalCompletions: number;
  hasDiffCount: number;
  zeroDiffCount: number;
  unknownCount: number;
  zeroDiffRate: number;
}

export function CompletionDiffCard() {
  const t = useTranslations('agents');
  const [data, setData] = useState<CompletionDiffStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/agent-metrics/completion-diff`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { success: boolean; data?: CompletionDiffStats };
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

  if (loading || !data || data.totalCompletions === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {t('completionDiff.title')}
      </h3>
      <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <FileX2 className="h-5 w-5 shrink-0 text-rose-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {(data.zeroDiffRate * 100).toFixed(0)}%
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('completionDiff.zeroDiffRate')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <FileDiff className="h-5 w-5 shrink-0 text-green-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.hasDiffCount}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('completionDiff.hasDiff')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <CircleSlash className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.zeroDiffCount}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('completionDiff.zeroDiff')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <HelpCircle className="h-5 w-5 shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.unknownCount}
            </div>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t('completionDiff.unknown')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

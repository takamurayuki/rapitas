'use client';
/**
 * PromptEvolutionSummary
 *
 * Read-only view of the PromptEvolution table (previously write-only —
 * prompt-evolution-runner.ts queues rows and recordPromptEvolution fills
 * them in, but nothing surfaced them). Groups rows by basePromptKey
 * (falling back to category for legacy rows) and shows, per prompt lineage,
 * how many candidates are queued vs completed and whether the completed
 * ones trended positive or negative. Does NOT pick or promote a "winner"
 * prompt — that would be a behavior change; this is observation only.
 */
import { useEffect, useState } from 'react';
import { History, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

interface PromptEvolutionGroupSummary {
  key: string;
  entryCount: number;
  pendingCount: number;
  completedCount: number;
  latestPerformanceDelta: number | null;
  averagePerformanceDelta: number | null;
  recentEntries: Array<{ id: number; status: string; performanceDelta: number }>;
}

function DeltaIcon({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return <Minus className="h-4 w-4 text-zinc-400" />;
  return delta > 0 ? (
    <TrendingUp className="h-4 w-4 text-green-500" />
  ) : (
    <TrendingDown className="h-4 w-4 text-red-500" />
  );
}

export function PromptEvolutionSummary() {
  const t = useTranslations('prompts');
  const [groups, setGroups] = useState<PromptEvolutionGroupSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/learning/prompt-evolution/summary`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { success: boolean; data: PromptEvolutionGroupSummary[] };
      })
      .then((v) => {
        if (cancelled) return;
        if (!v.success) {
          setLoadFailed(true);
          return;
        }
        setGroups(v.data);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        <History className="h-4 w-4 text-zinc-400" />
        {t('promptEvolution.title')}
      </h2>

      {loadFailed ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {t('promptEvolution.loadFailed')}
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {t('promptEvolution.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div
              key={group.key}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {group.key}
                </span>
                <DeltaIcon delta={group.latestPerformanceDelta} />
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{t('promptEvolution.entries', { count: group.entryCount })}</span>
                <span>
                  {t('promptEvolution.pendingOfCompleted', {
                    pending: group.pendingCount,
                    completed: group.completedCount,
                  })}
                </span>
              </div>
              {group.averagePerformanceDelta !== null && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {t('promptEvolution.avgDelta', {
                    value: group.averagePerformanceDelta.toFixed(3),
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

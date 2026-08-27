/**
 * RepairIterationMetricsPanel
 *
 * Displays, per verify_repair/ci_repair iteration, the change-set size
 * (files/additions/deletions from ActivityLog) and dwell time (from
 * WorkflowTransition timestamps) — both derived from EXISTING data with no
 * new instrumentation (task #672, operator-approved scope B). Test-pass-rate
 * delta and learning velocity are intentionally NOT computed: no structured
 * numeric test-result data exists in the pipeline, so this panel states that
 * explicitly rather than showing a guessed/placeholder value.
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { formatDurationMs } from '@/feature/tasks/components/detail/PhaseBreakdown';
import {
  parseRepairIterationMetrics,
  type RepairIterationMetricEntry,
} from './repair-iteration-metrics';

export interface RepairIterationMetricsPanelProps {
  taskId: number;
}

/**
 * Fetches a task's per-repair-iteration metrics once per taskId and renders
 * them as a neutral, data-only list; renders nothing when there are no
 * repair iterations yet.
 *
 * @param taskId - Task whose repair iterations to display / 対象タスクのID
 * @returns The panel, or null when there is nothing to show / パネル（該当なしは null）
 */
export default function RepairIterationMetricsPanel({ taskId }: RepairIterationMetricsPanelProps) {
  const t = useTranslations('workflow');
  const [iterations, setIterations] = useState<RepairIterationMetricEntry[]>([]);

  useEffect(() => {
    if (!taskId) {
      setIterations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/repair-iterations`);
        if (!res.ok) return;
        const data = (await res.json()) as { success?: boolean; iterations?: unknown };
        if (cancelled || !data.success) return;
        setIterations(parseRepairIterationMetrics(data.iterations));
      } catch {
        // Non-fatal — auxiliary metrics; the panel simply doesn't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (iterations.length === 0) return null;

  const causeLabel = (cause: RepairIterationMetricEntry['cause']): string =>
    t(`taskWorkflowSection.repairIterationMetrics.cause.${cause}`);

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('taskWorkflowSection.repairIterationMetrics.title')}
          </p>
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {iterations.map((entry) => (
            <li key={entry.id} className="px-4 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-700 dark:text-zinc-300">{causeLabel(entry.cause)}</span>
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {entry.dwellTimeMs === null
                    ? t('taskWorkflowSection.repairIterationMetrics.dwellNone')
                    : t('taskWorkflowSection.repairIterationMetrics.dwell', {
                        time: formatDurationMs(entry.dwellTimeMs),
                      })}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {entry.changeSet
                  ? t('taskWorkflowSection.repairIterationMetrics.changeSet', {
                      files: entry.changeSet.filesChanged,
                      additions: entry.changeSet.additions,
                      deletions: entry.changeSet.deletions,
                    })
                  : t('taskWorkflowSection.repairIterationMetrics.changeSetNone')}
              </p>
            </li>
          ))}
        </ul>
        <p className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800">
          {t('taskWorkflowSection.repairIterationMetrics.unavailableNote')}
        </p>
      </div>
    </div>
  );
}

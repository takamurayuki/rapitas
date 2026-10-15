/**
 * RepairStagnationBanner
 *
 * Neutral, data-only banner that surfaces the accumulated verify/ci repair
 * iteration count once it reaches the stagnation-risk threshold. Presents the
 * count as a fact for the user to weigh against context they hold separately
 * (complexity, past similar cases) — never an instruction to stop the task.
 * MVP scope (iteration count + threshold warning) only.
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Repeat } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import {
  deriveRepairIterations,
  hasReachedStagnationThreshold,
  type RawRepairTransition,
} from './repair-stagnation';

export interface RepairStagnationBannerProps {
  taskId: number;
}

/**
 * Fetches a task's transition log once per taskId and renders a neutral
 * status banner once the combined verify/ci repair-iteration count reaches
 * the stagnation-risk threshold; renders nothing otherwise.
 *
 * @param taskId - Task whose transition log to check / 対象タスクのID
 * @returns The banner, or null when below threshold / 該当なし / バナー（非該当は null）
 */
export default function RepairStagnationBanner({ taskId }: RepairStagnationBannerProps) {
  const t = useTranslations('workflow');
  const [iterationCount, setIterationCount] = useState(0);

  useEffect(() => {
    if (!taskId) {
      setIterationCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/transitions`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          success?: boolean;
          transitions?: RawRepairTransition[];
        };
        if (cancelled || !data.success || !data.transitions?.length) return;
        setIterationCount(deriveRepairIterations(data.transitions).length);
      } catch {
        // Non-fatal — this is auxiliary risk info; the banner simply doesn't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (!hasReachedStagnationThreshold(iterationCount)) return null;

  return (
    <div className="px-4 pb-4">
      <div
        role="status"
        aria-live="polite"
        aria-label={t('taskWorkflowSection.repairStagnation.ariaLabel', {
          count: iterationCount,
        })}
        className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3"
      >
        <div className="flex items-center gap-2">
          <Repeat
            className="h-4 w-4 text-zinc-500 dark:text-zinc-400 shrink-0"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('taskWorkflowSection.repairStagnation.title', { count: iterationCount })}
          </p>
        </div>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {t('taskWorkflowSection.repairStagnation.message')}
        </p>
      </div>
    </div>
  );
}

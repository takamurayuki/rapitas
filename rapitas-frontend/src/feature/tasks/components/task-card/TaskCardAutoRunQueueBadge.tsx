'use client';
/**
 * TaskCardAutoRunQueueBadge
 *
 * Static badge distinguishing two "not yet running" states that previously
 * looked identical to a plain todo card: auto-run has picked this task but
 * hasn't dispatched an agent yet (task.autoRunCurrent — e.g. an overlap-guard
 * hold still open), vs. eligible and simply waiting behind other tasks
 * (task.autoRunQueued). Renders nothing while an agent is actually
 * executing — the existing running badge/spin-border already covers that,
 * and this badge must never duplicate it.
 */
import { Layers3, CircleArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';
import { useElapsedTime } from '@/hooks/common/useElapsedTime';

interface TaskCardAutoRunQueueBadgeProps {
  task: Task;
  /** True while an agent is actually executing this task right now. */
  isExecuting: boolean;
}

/**
 * Renders the "next up" or "queued" auto-run badge for a task card, or
 * nothing when neither applies.
 *
 * @param task - Task carrying autoRunCurrent/autoRunQueued (server-computed). / 対象タスク
 * @param isExecuting - Whether an agent is currently running on this task. / 実行中か
 */
export default function TaskCardAutoRunQueueBadge({
  task,
  isExecuting,
}: TaskCardAutoRunQueueBadgeProps) {
  const t = useTranslations('task');
  const nextUpActive = Boolean(task.autoRunCurrent) && !isExecuting;
  // task.updatedAt approximates "since the last real progress" — the same
  // timestamp this session's supervisor kept checking by hand to tell a
  // stuck overlap-guard hold apart from normal dispatch latency.
  const waitingElapsed = useElapsedTime(nextUpActive ? task.updatedAt : null, nextUpActive);

  if (isExecuting) return null;

  if (task.autoRunCurrent) {
    return (
      <>
        <span className="text-zinc-300 dark:text-zinc-700">•</span>
        <span
          className="inline-flex items-center gap-1 shrink-0 font-medium text-zinc-600 dark:text-zinc-300"
          title={t('taskCard.autoRunNextUpTooltip')}
        >
          <CircleArrowRight className="w-3 h-3" aria-hidden="true" />
          {t('taskCard.autoRunNextUp')}
          {waitingElapsed && <span>{waitingElapsed}</span>}
        </span>
      </>
    );
  }

  if (task.autoRunQueued) {
    return (
      <>
        <span className="text-zinc-300 dark:text-zinc-700">•</span>
        <span
          className="inline-flex items-center gap-1 shrink-0 text-zinc-500 dark:text-zinc-400"
          title={t('taskCard.autoRunQueuedTooltip')}
        >
          <Layers3 className="w-3 h-3" aria-hidden="true" />
          {t('taskCard.autoRunQueued')}
        </span>
      </>
    );
  }

  return null;
}

'use client';

/**
 * DecisionTimerPanel
 *
 * Start/finish buttons for timing a triage decision and the typical-duration hint for its kind.
 * Not responsible for storing or computing durations (see use-decision-timer).
 */
import { ClockFading } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDecisionTimer } from '../_hooks/use-decision-timer';
import { MIN_SAMPLES } from '../_lib/decision-duration-stats';
import type { TriageItem } from '../_lib/triage-rules';

const BTN =
  'px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * @param item - The decision currently shown / 現在表示中の判断項目
 */
export function DecisionTimerPanel({ item }: { item: TriageItem }) {
  const t = useTranslations('triage.timer');
  const timer = useDecisionTimer({ itemId: item.id, kind: item.requestType });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 text-sm text-zinc-700 dark:text-zinc-300">
      <ClockFading className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 min-w-48">
        {timer.estimateMinutes === null
          ? t('insufficient', { min: MIN_SAMPLES })
          : t('estimate', { minutes: timer.estimateMinutes, count: timer.sampleCount })}
      </p>
      {timer.running ? (
        <>
          <span aria-live="off" className="tabular-nums">
            {t('elapsed', { time: formatElapsed(timer.elapsedMs) })}
          </span>
          <button type="button" className={BTN} aria-label={t('finish')} onClick={timer.finish}>
            {t('finish')}
          </button>
          <button type="button" className={BTN} aria-label={t('discard')} onClick={timer.discard}>
            {t('discard')}
          </button>
        </>
      ) : (
        <button type="button" className={BTN} aria-label={t('start')} onClick={timer.start}>
          {t('start')}
        </button>
      )}
    </div>
  );
}

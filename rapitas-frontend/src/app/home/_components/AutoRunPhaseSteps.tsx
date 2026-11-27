'use client';
/**
 * AutoRunPhaseSteps
 *
 * The phase list (調査・計画・実装・検証) and the answer-wait flag of the
 * auto-run strip, for whichever task the strip shows.
 */
import { CheckCircle2, Circle, Hourglass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProgressStepState, ProgressView } from './auto-run-progress.utils';

const STEP_TEXT: Record<ProgressStepState, string> = {
  done: 'text-emerald-600 dark:text-emerald-400',
  current: 'font-medium text-zinc-900 dark:text-zinc-50',
  waiting: 'font-medium text-amber-600 dark:text-amber-400',
  pending: 'text-zinc-400 dark:text-zinc-500',
};

function StepIcon({ state }: { state: ProgressStepState }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (state === 'done') return <CheckCircle2 className={cls} aria-hidden="true" />;
  // NOTE: A still green dot, not a spinner (2026-11-21): the task card's
  // spinning border already says the task runs, and several spinners at
  // once tired the eyes. Same dot as the toolbar's 「自動実行中」.
  if (state === 'current')
    return (
      <span className={`${cls} inline-flex items-center justify-center`} aria-hidden="true">
        <span
          data-current-dot=""
          className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
        />
      </span>
    );
  // Hourglass = 承認待ち／回答待ち (ICON_POLICY).
  if (state === 'waiting') return <Hourglass className={cls} aria-hidden="true" />;
  return <Circle className={cls} aria-hidden="true" />;
}

/**
 * @param props.view - Phase view of the shown task / 表示中タスクのフェーズ
 * @returns The step list and the answer-wait flag / ステップ列
 */
export function AutoRunPhaseSteps({ view }: { view: ProgressView }) {
  const t = useTranslations('autoRun');
  return (
    <>
      <ol className="flex items-center gap-1.5">
        {view.steps.map(({ key: step, state }, i) => (
          <li key={step} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden="true" className="h-px w-[18px] bg-zinc-300 dark:bg-zinc-700" />
            )}
            <span
              data-step={step}
              data-step-state={state}
              className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${STEP_TEXT[state]}`}
            >
              <StepIcon state={state} />
              {state === 'waiting' && view.waitingFor === 'approval'
                ? t('awaitingApproval')
                : t(`progress.steps.${step}`)}
            </span>
          </li>
        ))}
      </ol>

      {view.waitingFor === 'answer' && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
          <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
          {t('progress.awaitingAnswer')}
        </span>
      )}
    </>
  );
}

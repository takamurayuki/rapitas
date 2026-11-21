'use client';
/**
 * AutoRunProgressStrip
 *
 * Full-width strip under the home toolbar, shown only while auto-run is on:
 * the task being worked on (a link to its detail page), its phase, the
 * remaining backlog and the time since the run started. The toolbar panel
 * beside the task buttons only had room for "実行中" (2026-11-21).
 * Not responsible for controlling the run or for fetching its state.
 */
import Link from 'next/link';
import { CheckCircle2, Circle, Hourglass, Loader2, Repeat } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useElapsedTime } from '@/hooks/common/useElapsedTime';
import type { AutoRunStatus, CurrentTask } from '@/hooks/workflow/useThemeAutoRun';
import {
  phaseOfStatus,
  progressFromWorkflowStatus,
  type ProgressStepState,
} from './auto-run-progress.utils';

interface AutoRunProgressStripProps {
  /** Auto-run status; the strip renders only while running or paused. / 自動実行の状態 */
  status: AutoRunStatus;
  /** Task being worked on, or null between tasks. / 処理中のタスク */
  currentTask: CurrentTask | null;
  /** Tasks still waiting in the backlog. / 残りのタスク数 */
  remainingCount: number;
  /** When the run started (ISO), or null. / 開始時刻 */
  startedAt: string | null;
}

const STEP_TEXT: Record<ProgressStepState, string> = {
  done: 'text-emerald-600 dark:text-emerald-400',
  current: 'font-medium text-zinc-900 dark:text-zinc-50',
  waiting: 'font-medium text-amber-600 dark:text-amber-400',
  pending: 'text-zinc-400 dark:text-zinc-500',
};

function StepIcon({ state }: { state: ProgressStepState }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (state === 'done') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (state === 'current')
    return <Loader2 className={`${cls} animate-spin text-emerald-500`} aria-hidden="true" />;
  // Hourglass = 承認待ち／回答待ち (ICON_POLICY).
  if (state === 'waiting') return <Hourglass className={cls} aria-hidden="true" />;
  return <Circle className={cls} aria-hidden="true" />;
}

/**
 * Show what auto-run is doing now, under the toolbar.
 *
 * @param props.status - Auto-run status / 自動実行の状態
 * @param props.currentTask - Task being worked on / 処理中のタスク
 * @param props.remainingCount - Remaining backlog / 残りのタスク数
 * @param props.startedAt - Run start time / 開始時刻
 * @returns The strip, or null while auto-run is idle or stopping / 帯（停止時は null）
 */
export function AutoRunProgressStrip({
  status,
  currentTask,
  remainingCount,
  startedAt,
}: AutoRunProgressStripProps) {
  const t = useTranslations('autoRun');
  const visible = status === 'running' || status === 'paused';
  // Only re-renders the strip while running; the text below is minute-grained.
  useElapsedTime(startedAt, visible && status === 'running');

  if (!visible) return null;

  const view = currentTask
    ? progressFromWorkflowStatus(currentTask.workflowStatus, currentTask.workflowMode)
    : null;

  // "検証 → 実装": the phase the latest send-back left and the one it redoes.
  // research_done left means research had been reached, not the next phase.
  const rework = currentTask?.rework;
  const fromPhase = rework
    ? rework.lastFromStatus === 'research_done'
      ? 'research'
      : phaseOfStatus(rework.lastFromStatus, currentTask?.workflowMode)
    : null;
  const toPhase = rework ? phaseOfStatus(rework.lastToStatus, currentTask?.workflowMode) : null;
  const reworkRoute =
    rework && fromPhase && toPhase
      ? t('progress.reworkRoute', {
          from: t(`progress.steps.${fromPhase}`),
          to: t(`progress.steps.${toPhase}`),
        })
      : null;
  const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const minutes = Number.isNaN(startMs)
    ? null
    : Math.max(0, Math.floor((Date.now() - startMs) / 60_000));
  const elapsed =
    minutes === null
      ? null
      : minutes >= 60
        ? t('progress.elapsedHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
        : t('progress.elapsedMinutes', { minutes });

  // NOTE: design C draws the strip as a white band with only a hairline on
  // top — no outline — so it reads as part of the toolbar, not a card.
  return (
    <div
      data-testid="auto-run-progress-strip"
      aria-label={t('progress.label')}
      className="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-zinc-200 bg-white px-3.5 py-2 text-[13px] dark:border-zinc-800 dark:bg-zinc-900"
    >
      {currentTask && view ? (
        <>
          <Link
            href={`/tasks/${currentTask.id}?showHeader=true`}
            title={currentTask.title}
            className="max-w-sm min-w-0 truncate text-indigo-600 hover:underline dark:text-indigo-400"
          >
            #{currentTask.id} {currentTask.title}
          </Link>

          <ol className="flex items-center gap-1.5">
            {view.steps.map(({ key: step, state }, i) => {
              return (
                <li key={step} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span
                      aria-hidden="true"
                      className="h-px w-[18px] bg-zinc-300 dark:bg-zinc-700"
                    />
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
              );
            })}
          </ol>

          {view.waitingFor === 'answer' && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
              {t('progress.awaitingAnswer')}
            </span>
          )}

          {currentTask.rework && (
            // Repeat = 修復反復 (ICON_POLICY): the same concept, counted per task.
            <span
              data-testid="auto-run-rework"
              className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-amber-600 dark:text-amber-400"
            >
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-medium">
                {t('progress.rework', { count: currentTask.rework.count })}
              </span>
              {reworkRoute && <span>{reworkRoute}</span>}
            </span>
          )}
        </>
      ) : (
        <span className="text-zinc-500 dark:text-zinc-400">
          {status === 'paused' ? t('statusPaused') : t('progress.choosingNext')}
        </span>
      )}

      <span className="ml-auto text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
        {t('progress.remaining', { count: remainingCount })}
        {elapsed && (
          <>
            <span aria-hidden="true"> · </span>
            {elapsed}
          </>
        )}
      </span>
    </div>
  );
}

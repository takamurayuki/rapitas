'use client';
/**
 * AutoRunProgressStrip
 *
 * Full-width strip under the home toolbar, shown only while auto-run is on:
 * the task being worked on (a link to its detail page), its phase, the
 * remaining backlog and the time since the run started. With several tasks
 * running in the theme (task 1552) it also lists the others. The toolbar panel
 * beside the task buttons only had room for "実行中" (2026-11-21).
 * Not responsible for controlling the run or for fetching its state.
 */
import Link from 'next/link';
import { Repeat } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useElapsedTime } from '@/hooks/common/useElapsedTime';
import type { ActiveTask, AutoRunStatus, CurrentTask } from '@/hooks/workflow/useThemeAutoRun';
import {
  phaseOfStatus,
  phaseSendBackLeft,
  progressFromWorkflowStatus,
  stepsForMode,
  type ProgressView,
} from './auto-run-progress.utils';
import { FilterScopeLabel, ShowFilterButton, type FilterScope } from './HomeFilterSummary';
import { HOME_CARD_FRAME } from './home-card-frame';
import { AutoRunPhaseSteps } from './AutoRunPhaseSteps';
import { AutoRunTaskSelect } from './AutoRunTaskSelect';
import { useAutoRunTaskSelection } from './useAutoRunTaskSelection';
import { useSelectedTaskStatus } from './useSelectedTaskStatus';

interface AutoRunProgressStripProps {
  /** Auto-run status; the strip renders only while running or paused. / 自動実行の状態 */
  status: AutoRunStatus;
  /** Task being worked on, or null between tasks. / 処理中のタスク */
  currentTask: CurrentTask | null;
  /** Tasks still waiting in the backlog. / 残りのタスク数 */
  remainingCount: number;
  /** When the run started (ISO), or null. / 開始時刻 */
  startedAt: string | null;
  /** True while no new work starts until merged code activates (task 1562). / 更新の取り込み待ち */
  restartWait?: boolean;
  /**
   * The hidden filter's category and theme, merged in rather than drawn as a
   * second band (2026-11-21); null while the filter is shown. / 隠したフィルターの範囲
   */
  scope?: FilterScope | null;
  /** Every running task of the theme, head first; 2+ shows the task dropdown (task 1565). / 動作中の全タスク */
  activeTasks?: ActiveTask[];
  /** Theme the choice in the dropdown is remembered under. / 選択の記憶先テーマ */
  themeId?: number | null;
}

const SEPARATOR = (
  <span aria-hidden="true" className="h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700" />
);

/**
 * Show what auto-run is doing now, under the toolbar.
 *
 * @param props.status - Auto-run status / 自動実行の状態
 * @param props.currentTask - Task being worked on / 処理中のタスク
 * @param props.remainingCount - Remaining backlog / 残りのタスク数
 * @param props.startedAt - Run start time / 開始時刻
 * @param props.scope - Hidden filter's category and theme / 隠したフィルターの範囲
 * @param props.activeTasks - Running tasks of the theme / 動作中の全タスク
 * @param props.themeId - Theme for remembering the choice / テーマID
 * @returns The strip, or null while auto-run is idle or stopping / 帯（停止時は null）
 */
export function AutoRunProgressStrip({
  status,
  currentTask,
  remainingCount,
  startedAt,
  restartWait,
  scope,
  activeTasks,
  themeId,
}: AutoRunProgressStripProps) {
  const t = useTranslations('autoRun');
  const showSelect = (activeTasks?.length ?? 0) >= 2;
  const { selectedId, headId, select } = useAutoRunTaskSelection(themeId, activeTasks);
  // The head's state is already in currentTask; only others are fetched.
  const otherId = showSelect && selectedId !== null && selectedId !== headId ? selectedId : null;
  const otherStatus = useSelectedTaskStatus(otherId);
  const visible = status === 'running' || status === 'paused';
  // Only re-renders the strip while running; the text below is minute-grained.
  useElapsedTime(startedAt, visible && status === 'running');

  if (!visible) return null;

  // Another task picked in the dropdown replaces the head's phase and link;
  // its rework is unknown (activeTasks has none), so it is left out.
  const other = otherId !== null ? activeTasks?.find((a) => a.id === otherId) : undefined;
  const shown: CurrentTask | null =
    currentTask && other
      ? {
          id: other.id,
          title: other.title,
          status: currentTask.status,
          workflowStatus: otherStatus?.workflowStatus ?? null,
          workflowMode: otherStatus?.workflowMode ?? null,
        }
      : currentTask;
  // 未取得は実際の workflowStatus=null（調査中）と区別する。
  const view: ProgressView | null =
    other && !otherStatus
      ? {
          steps: stepsForMode(null).map((key) => ({ key, state: 'pending' })),
          waitingFor: null,
        }
      : shown
        ? progressFromWorkflowStatus(shown.workflowStatus, shown.workflowMode)
        : null;

  // "検証 → 実装": the phase the latest send-back left and the one it redoes.
  const rework = currentTask?.rework;
  const fromPhase = rework ? phaseSendBackLeft(rework, currentTask?.workflowMode) : null;
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

  // NOTE: Drawn in the filter's card frame (HOME_CARD_FRAME) so the strip and
  // the filter below it read as one set (asked 2026-11-21). It replaced design
  // C's outline-less band with a top hairline.
  return (
    <div
      data-testid="auto-run-progress-strip"
      aria-label={t('progress.label')}
      className={`${HOME_CARD_FRAME} mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 py-2 text-[13px]`}
    >
      {scope && (
        <>
          <FilterScopeLabel category={scope.category} theme={scope.theme} />
          {SEPARATOR}
        </>
      )}
      {currentTask && shown && view ? (
        <>
          {showSelect && activeTasks && (
            <AutoRunTaskSelect tasks={activeTasks} selectedId={selectedId} onSelect={select} />
          )}
          {/* NOTE: Only the id shows (asked 2026-11-21); the title stays in
              title / aria-label for hover and screen readers. */}
          <Link
            href={`/tasks/${shown.id}?showHeader=true`}
            title={shown.title}
            aria-label={`#${shown.id} ${shown.title}`}
            className="shrink-0 text-indigo-600 hover:underline dark:text-indigo-400"
          >
            #{shown.id}
          </Link>

          <AutoRunPhaseSteps view={view} />

          {!showSelect && currentTask.companions && currentTask.companions.length > 0 && (
            // Task 1552: other tasks of the theme run alongside the head. No new
            // glyph (ICON_POLICY) — the ids link to their detail pages.
            <span
              data-testid="auto-run-parallel"
              className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300"
            >
              <span className="font-medium">
                {t('progress.parallel', { count: currentTask.companions.length + 1 })}
              </span>
              {currentTask.companions.map((c) => (
                <Link
                  key={c.id}
                  href={`/tasks/${c.id}?showHeader=true`}
                  title={c.title}
                  aria-label={`#${c.id} ${c.title}`}
                  className="text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  #{c.id} {c.title}
                </Link>
              ))}
            </span>
          )}

          {!other && currentTask.rework && (
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

      {restartWait && (
        // Hourglass = 承認待ち／回答待ち／待機 (ICON_POLICY): the same "waiting" concept.
        <span
          data-testid="auto-run-restart-wait"
          className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-amber-600 dark:text-amber-400"
        >
          <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
          {t('progress.restartWait')}
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
      {scope && (
        <>
          {SEPARATOR}
          <ShowFilterButton onShow={scope.onShow} short />
        </>
      )}
    </div>
  );
}

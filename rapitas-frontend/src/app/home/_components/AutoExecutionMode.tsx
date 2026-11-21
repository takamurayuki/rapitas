'use client';
/**
 * AutoExecutionMode
 *
 * Toolbar toggle for per-theme task auto-execution. Starts/stops the selected
 * development theme's auto-run. Not AI task generation — runs existing todo
 * tasks in priority order. Rendered only when a development theme is active.
 *
 * Buttons (開始 / 再開 / 停止) match the toolbar's "タスクを作成"/"一括" buttons
 * (HomeToolbar.tsx): rounded-lg, px-3.5 py-2, gap-2 and the 2px bottom ridge.
 * The running / paused status beside them is plain text, never a button shape.
 * One accent (indigo) for the whole control; 停止 is neutral until hovered.
 */
import { Play, Square, Loader2, Pause } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useThemeAutoRun } from '@/hooks/workflow/useThemeAutoRun';
import { Spinner } from '@/components/ui/spinner';
import { ToolbarGroup } from './ToolbarGroup';

interface AutoExecutionModeProps {
  /** Selected development theme to control, or null when none is active. */
  theme?: { id: number; isDevelopment?: boolean } | null;
}

/**
 * Start/stop control for a theme's task auto-execution.
 *
 * @param props.theme - The active development theme (id + isDevelopment). / 対象の開発テーマ
 * @returns The control, or null for non-development themes. / コントロール（非開発テーマはnull）
 */
export function AutoExecutionMode({ theme }: AutoExecutionModeProps) {
  const t = useTranslations('home');
  const tSettings = useTranslations('settings');
  const tAutoRun = useTranslations('autoRun');
  const { data, actionLoading, error, start, stop } = useThemeAutoRun(
    theme?.id ?? null,
    theme?.isDevelopment,
  );

  if (!theme?.isDevelopment) return null;

  const status = data?.autoRun?.status ?? 'idle';

  const errorBadge = error ? (
    <span className="max-w-40 truncate text-xs text-red-600 dark:text-red-400" title={error}>
      {error}
    </span>
  ) : null;

  // Sits after the task actions in the toolbar, in its own labelled group
  // (タスク実行). The group is drawn here, not by the toolbar, because the
  // control renders nothing for non-development themes.
  const groupLabel = t('toolbarGroup.autoRun');

  // ── Idle ─────────────────────────────────────────────────────────────────
  if (status === 'idle') {
    return (
      <ToolbarGroup id="auto-run" label={groupLabel}>
        <button
          onClick={() => start('priority')}
          disabled={actionLoading}
          title={t('autoExecutionMode.startTitle')}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-3.5 py-2 text-sm font-medium text-indigo-600 shadow-[0_2px_0_0_#a5b4fc] select-none transition-all duration-75 hover:border-indigo-400 hover:bg-indigo-50 active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-zinc-900 dark:text-indigo-400 dark:shadow-[0_2px_0_0_#312e81] dark:hover:border-indigo-600 dark:hover:bg-indigo-950/40"
        >
          {actionLoading ? (
            <Spinner size="sm" className="text-indigo-400 dark:text-indigo-400" />
          ) : (
            // NOTE: dark keeps the light structure (colored circle badge); the
            // glyph is zinc-900 = the button's dark bg (user request — a white
            // or bare accent triangle stood out too much). Same rule as PillButton.
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 dark:bg-indigo-400">
              <Play className="h-2.5 w-2.5 fill-white text-white dark:fill-zinc-900 dark:text-zinc-900" />
            </span>
          )}
          {tSettings('devModeTitle')}
        </button>
        {errorBadge}
      </ToolbarGroup>
    );
  }

  // ── Stopping ──────────────────────────────────────────────────────────────
  if (status === 'stopping') {
    return (
      <ToolbarGroup id="auto-run" label={groupLabel}>
        <button
          disabled
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-500 opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin text-zinc-500 dark:text-zinc-900" />
          </span>
          {tAutoRun('statusStopping')}
        </button>
        {errorBadge}
      </ToolbarGroup>
    );
  }

  // ── Running / Paused ─────────────────────────────────────────────────────
  // NOTE: Two controls since 2026-10-31, where it was one wide button labelled
  // "タスク自動実行中" whose onClick was stop(). The visible label did not
  // describe what pressing it did, nothing revealed that it stopped anything
  // until the pointer was over it, and on a touch screen the stop could not be
  // reached at all. Running-ness is already said by ラピ, the task cards and
  // SystemStatusPanel, so the control does not need to be a fourth status
  // display at the cost of hiding its only action.
  //
  // The status is a plain span, so the status can no longer be clicked into a
  // stop — a USER stop sets `enabled = false` and is never auto re-armed
  // (theme-auto-run-mutations.finalizeStop), so a misclick cost a run that
  // only a deliberate 開始 brings back.
  //
  // Splitting also retires the overlay that existed to keep the Orbit
  // spinner's ancestor from color-transitioning mid-frame: the stop is a
  // sibling now, so nothing above the spinner changes on hover.
  //
  // No pause button, though the hook offers one: pausing is known to leave the
  // in-flight WorkflowQueueItem holding the only concurrency slot, starving
  // every theme (memory: pause-strands-the-only-slot).
  const paused = status === 'paused';

  // NOTE (2026-11-21): the status used to carry the same border and bottom
  // ridge as the toolbar buttons, so it read as a button, while the stop
  // beside it read as flat. Now the status is plain text with one coloured
  // dot, and only the actions are raised. The whole control keeps one accent
  // (indigo, the 開始 colour): resuming is the same act as starting, and the
  // stop is a neutral ridge that turns red only under the pointer — five
  // differently coloured buttons on one toolbar hid which one mattered.
  const dot = paused ? 'bg-amber-400' : 'bg-emerald-500 dark:bg-emerald-400';

  return (
    <ToolbarGroup id="auto-run" label={groupLabel}>
      {/* STATUS — says what is happening; plain text, never a button shape. */}
      <span
        data-auto-run-status=""
        className="inline-flex items-center gap-1.5 px-1 text-sm font-medium text-zinc-600 select-none dark:text-zinc-300"
      >
        {paused ? (
          <Pause className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
        ) : (
          <span className={`h-2 w-2 shrink-0 animate-pulse rounded-full ${dot}`} />
        )}
        <span>{paused ? t('autoExecutionMode.paused') : t('autoExecutionMode.runningLabel')}</span>
      </span>

      {/* RESUME — only while paused; the same act and colour as 開始. */}
      {paused && (
        <button
          onClick={() => start('priority')}
          disabled={actionLoading}
          title={tAutoRun('resumeTitle')}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-3.5 py-2 text-sm font-medium text-indigo-600 shadow-[0_2px_0_0_#a5b4fc] select-none transition-all duration-75 hover:border-indigo-400 hover:bg-indigo-50 active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-zinc-900 dark:text-indigo-400 dark:shadow-[0_2px_0_0_#312e81] dark:hover:border-indigo-600 dark:hover:bg-indigo-950/40"
        >
          <Play className="h-3 w-3 fill-current" />
          {tAutoRun('resume')}
        </button>
      )}

      {/* STOP — raised like the toolbar buttons, neutral until hovered: it
          cannot be undone, so it does not compete with the primary action. */}
      <button
        onClick={() => stop()}
        disabled={actionLoading}
        title={t('autoExecutionMode.stopTitle')}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 shadow-[0_2px_0_0_#d4d4d8] select-none transition-all duration-75 hover:border-red-300 hover:bg-red-50 hover:text-red-600 active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:shadow-[0_2px_0_0_#3f3f46] dark:hover:border-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-400"
      >
        {actionLoading ? (
          <Spinner size="sm" className="text-zinc-400 dark:text-zinc-500" />
        ) : (
          <Square className="h-3 w-3 fill-current" />
        )}
        {tAutoRun('stop')}
      </button>
      {errorBadge}
    </ToolbarGroup>
  );
}

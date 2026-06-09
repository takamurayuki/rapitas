'use client';
/**
 * AutoExecutionMode
 *
 * Toolbar toggle for per-theme task auto-execution. Starts/stops the selected
 * development theme's auto-run, which runs that theme's EXISTING todo tasks one
 * at a time (highest priority first, then creation order). This is NOT AI task
 * generation. Rendered only when a development theme is active.
 *
 * While running, the button reads "タスク自動実行中" with a spinning,
 * gently-pulsing indicator (so it clearly looks alive) and swaps to a red
 * "停止" on hover.
 * While stopping, it shows a loading spinner and is disabled.
 */
import { Play, Square, Loader2, Orbit, Pause } from 'lucide-react';
import { useThemeAutoRun } from '@/hooks/workflow/useThemeAutoRun';

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
  const { data, actionLoading, error, start, stop } = useThemeAutoRun(
    theme?.id ?? null,
    theme?.isDevelopment,
  );

  // Auto-run is a per-development-theme feature — nothing to show otherwise.
  if (!theme?.isDevelopment) return null;

  const status = data?.autoRun?.status ?? 'idle';

  const errorBadge = error ? (
    <span className="max-w-40 truncate text-xs text-red-600 dark:text-red-400" title={error}>
      {error}
    </span>
  ) : null;

  // Idle — plain start button.
  if (status === 'idle') {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => start('priority')}
          disabled={actionLoading}
          title="このテーマのToDoタスクをAI生成なしで上から順に自動実行します"
          className="inline-flex min-w-32 items-center justify-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
        >
          {actionLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4 shrink-0" />
          )}
          タスク自動実行
        </button>
        {errorBadge}
      </div>
    );
  }

  // Stopping — loading spinner, disabled (no hover swap).
  if (status === 'stopping') {
    return (
      <div className="flex items-center gap-2">
        <button
          disabled
          className="inline-flex min-w-32 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 opacity-80 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          停止中
        </button>
        {errorBadge}
      </div>
    );
  }

  // Active (running / paused) — show a live "running" affordance at rest, and
  // swap to a red "停止" on hover so the active state reads clearly but stopping
  // is one click away. Paused (awaiting plan approval) uses an amber rest state.
  const paused = status === 'paused';
  const restColors = paused
    ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => stop()}
        disabled={actionLoading}
        title="自動実行を停止します"
        className={`group inline-flex min-w-32 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-red-700 dark:hover:bg-red-900/30 dark:hover:text-red-400 ${restColors}`}
      >
        {/* Rest state — hidden on hover. Conveys "agent is working".
            Orbit spins cleanly because: shrink-0 keeps the SVG square (flex
            compression made it oval → warped rotation); transform-origin:center
            rotates about the true center; will-change-transform promotes it to
            its own GPU layer so it isn't re-rasterized mid-spin (the source of
            the jitter). The pulse is on the LABEL only — never the spinning
            icon — so an opacity animation never re-rasterizes the rotation. */}
        <span className="inline-flex items-center gap-2 group-hover:hidden">
          {paused ? (
            <Pause className="h-4 w-4 shrink-0" />
          ) : (
            <Orbit className="h-4 w-4 shrink-0 animate-spin [transform-origin:center] will-change-transform" />
          )}
          <span className={paused ? '' : 'animate-pulse'}>
            {paused ? '一時停止' : 'タスク自動実行中'}
          </span>
        </span>
        {/* Hover state — the stop action. */}
        <span className="hidden items-center gap-2 group-hover:inline-flex">
          <Square className="h-4 w-4 fill-current" />
          停止
        </span>
      </button>
      {errorBadge}
    </div>
  );
}

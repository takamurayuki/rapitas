'use client';
/**
 * AutoExecutionMode
 *
 * Toolbar toggle for per-theme task auto-execution. Starts/stops the selected
 * development theme's auto-run. Not AI task generation — runs existing todo
 * tasks in priority order. Rendered only when a development theme is active.
 *
 * Shape: standard ridge button (rounded-lg + px-3.5 py-2 + gap-2), matching
 *        the sibling toolbar buttons (create task / bulk select / delete).
 * Icon:  flat 4x4 glyph in the button's text color (no circle badge).
 * Hover: opaque absolute overlay swaps to red "停止" without touching the
 *        spinning ancestor (prevents rasterization glitch on the Orbit icon).
 */
import { Play, Square, Orbit, Pause } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useThemeAutoRun } from '@/hooks/workflow/useThemeAutoRun';
import { Spinner } from '@/components/ui/spinner';

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

  // ── Idle ─────────────────────────────────────────────────────────────────
  if (status === 'idle') {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => start('priority')}
          disabled={actionLoading}
          title={t('autoExecutionMode.startTitle')}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-3.5 py-2 text-sm font-medium text-indigo-600 shadow-[0_2px_0_0_#a5b4fc] select-none transition-all duration-75 hover:border-indigo-400 hover:bg-indigo-50 active:translate-y-[2px] active:shadow-none active:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-zinc-900 dark:text-indigo-400 dark:shadow-[0_2px_0_0_#312e81] dark:hover:border-indigo-600 dark:hover:bg-indigo-950/40 dark:active:bg-indigo-900/20"
        >
          {actionLoading ? (
            <Spinner size="sm" className="text-indigo-400 dark:text-indigo-400" />
          ) : (
            <Play className="w-4 h-4 shrink-0 fill-current" />
          )}
          {tSettings('devModeTitle')}
        </button>
        {errorBadge}
      </div>
    );
  }

  // ── Stopping ──────────────────────────────────────────────────────────────
  if (status === 'stopping') {
    return (
      <div className="flex items-center gap-2">
        <button
          disabled
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-500 opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
        >
          <Spinner size="sm" className="text-zinc-500 dark:text-zinc-500" />
          {tAutoRun('statusStopping')}
        </button>
        {errorBadge}
      </div>
    );
  }

  // ── Running / Paused ─────────────────────────────────────────────────────
  // Rest state is always visible; the hover overlay covers it entirely with the
  // red "停止" look. The Orbit spinner's parent never changes appearance, which
  // prevents the rasterization warp that occurs when a spinning element's
  // ancestor color-transitions mid-frame.
  const paused = status === 'paused';

  const restBorder = paused
    ? 'border-amber-300 dark:border-amber-700'
    : 'border-emerald-300 dark:border-emerald-700';
  const restShadow = paused
    ? 'shadow-[0_2px_0_0_#fcd34d] dark:shadow-[0_2px_0_0_#78350f]'
    : 'shadow-[0_2px_0_0_#a7f3d0] dark:shadow-[0_2px_0_0_#065f46]';
  const restText = paused
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-emerald-700 dark:text-emerald-400';

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => stop()}
        disabled={actionLoading}
        title={t('autoExecutionMode.stopTitle')}
        className={`group relative inline-flex items-center gap-2 rounded-lg border bg-white px-3.5 py-2 text-sm font-medium select-none transition-all duration-75 hover:shadow-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 ${restBorder} ${restShadow} ${restText}`}
      >
        {/* REST — flat icon + label. Parent never mutates on hover (overlay
            handles the visual swap), so the Orbit spin stays artifact-free. */}
        {paused ? (
          <Pause className="w-4 h-4 shrink-0" />
        ) : (
          // NOTE: Orbit spins inside a fixed-size box (not the <svg> itself) and
          // stays mounted at all times — see docs/design/ui-design-language.md §9.
          <span className="inline-flex h-4 w-4 shrink-0 animate-spin items-center justify-center [transform-origin:center]">
            <Orbit className="h-4 w-4" />
          </span>
        )}
        <span>{paused ? t('autoExecutionMode.paused') : t('autoExecutionMode.runningLabel')}</span>

        {/* HOVER OVERLAY — fully opaque; instant opacity swap (no transition)
            so the spinner's parent never sees a mid-fade partial repaint. */}
        <span className="absolute -inset-px flex items-center gap-2 rounded-lg border border-red-300 bg-white pl-3.5 pr-4 text-red-600 opacity-0 shadow-[0_2px_0_0_#fca5a5] group-hover:opacity-100 dark:border-red-700 dark:bg-zinc-900 dark:text-red-400 dark:shadow-[0_2px_0_0_#991b1b]">
          <Square className="w-4 h-4 shrink-0 fill-current" />
          {tAutoRun('stop')}
        </span>
      </button>
      {errorBadge}
    </div>
  );
}

/**
 * pomodoroFloatView
 *
 * Main body of the Pomodoro floating window: window chrome (drag region,
 * transparency toggle, focus toggle, minimize, close) plus either the idle
 * empty state or the shared PomodoroPanelContent. The panel UI itself lives in
 * PomodoroPanelContent (the single source shared with — formerly — the modal);
 * this file only adds the float-only window chrome around it.
 */
'use client';

import { X, Minus, GlassWater, Focus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePomodoroStore } from '@/feature/tasks/pomodoro/pomodoro-store';
import PomodoroPanelContent from '@/feature/tasks/pomodoro/PomodoroPanelContent';
import { useTransparencyMode } from '../_hooks/use-transparency-mode';
import { useFocusMode } from '../_hooks/use-focus-mode';
import { useFloatPageBackground } from '../_hooks/use-float-page-background';
import PomodoroFloatEmptyState from './pomodoro-float-empty-state';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// NOTE: close() (not hide()) — app_setup.rs's CloseRequested handler only
// forces hide-on-close for the "main" window label, so this actually destroys
// the window. Re-showing it goes through the header's Pomodoro button, which
// recreates it via focus_pomodoro_float (same builder used at app startup).
async function closeFloatWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

async function minimizeFloatWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().minimize();
}

export default function PomodoroFloatView() {
  const t = useTranslations('pomodoro');
  const state = usePomodoroStore();
  const { mode, toggleMode } = useTransparencyMode();
  const { focusMode, toggleFocusMode } = useFocusMode();
  useFloatPageBackground(mode);

  const isGlass = mode === 'glass';
  // .transparent(true) is always set on the Rust side — toggling between modes
  // is purely a CSS surface swap, no window rebuild.
  const surfaceCls = isGlass
    ? 'bg-white/55 dark:bg-zinc-900/55 backdrop-blur-md border border-white/20 dark:border-white/10'
    : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800';
  const textShadowCls = isGlass ? '[text-shadow:0_1px_3px_rgba(0,0,0,0.45)]' : '';

  // taskId may legitimately be null for a taskless session, so isTimerRunning
  // alone decides whether to show the panel vs the idle empty state.
  const showTimer = state.isTimerRunning;

  return (
    <div
      className={`fixed inset-0 flex flex-col overflow-y-auto rounded-xl ${surfaceCls} ${textShadowCls}`}
    >
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 select-none items-center justify-end gap-1 px-2"
      >
        <div data-tauri-drag-region className="h-8 flex-1 cursor-move" />
        <button
          type="button"
          onClick={toggleFocusMode}
          aria-pressed={focusMode}
          aria-label={t('focusMode')}
          title={t('focusMode')}
          className={`rounded-lg p-1.5 transition-colors ${
            focusMode
              ? 'text-indigo-500 dark:text-indigo-400'
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          }`}
        >
          <Focus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={toggleMode}
          aria-pressed={isGlass}
          aria-label={t('floatTransparencyToggle')}
          title={t('floatTransparencyToggle')}
          className={`rounded-lg p-1.5 transition-colors ${
            isGlass
              ? 'text-indigo-500 dark:text-indigo-400'
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          }`}
        >
          <GlassWater className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void minimizeFloatWindow()}
          aria-label={t('floatMinimize')}
          title={t('floatMinimize')}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void closeFloatWindow()}
          aria-label={t('floatClose')}
          title={t('floatClose')}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!showTimer ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-3 pb-3">
          <PomodoroFloatEmptyState />
        </div>
      ) : (
        <PomodoroPanelContent
          taskId={state.taskId!}
          taskTitle={state.taskTitle ?? t('taskDefaultName')}
          focusMode={focusMode}
        />
      )}
    </div>
  );
}

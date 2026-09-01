/**
 * pomodoroFloatView
 *
 * Main body of the Pomodoro floating window: drag region, transparency
 * toggle, close button, and either the empty state or the progress
 * ring + controls. Mounts usePomodoroStore directly — cross-window sync
 * comes for free from the store's existing BroadcastChannel/localStorage
 * wiring (no bespoke plumbing here).
 */
'use client';

import { X, GlassWater } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  usePomodoroStore,
  getRemainingTime,
  formatTime,
} from '@/feature/tasks/pomodoro/pomodoro-store';
import { useTransparencyMode } from '../_hooks/use-transparency-mode';
import PomodoroProgressRing from './pomodoro-progress-ring';
import PomodoroFloatControls from './pomodoro-float-controls';
import PomodoroFloatEmptyState from './pomodoro-float-empty-state';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function closeFloatWindow(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('toggle_pomodoro_float');
}

async function requestCheckpoint(): Promise<void> {
  if (!isTauri()) return;
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', 'pomodoro-float:checkpoint-request');
}

export default function PomodoroFloatView() {
  const t = useTranslations('pomodoro');
  const state = usePomodoroStore();
  const { mode, toggleMode } = useTransparencyMode();

  const isGlass = mode === 'glass';
  // .transparent(true) is always set on the Rust side (plan.md 「透過モードの実装方式」) —
  // toggling between modes is purely a CSS surface swap, no window rebuild.
  const surfaceCls = isGlass
    ? 'bg-white/55 dark:bg-zinc-900/55 backdrop-blur-md border border-white/20 dark:border-white/10'
    : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800';
  const textShadowCls = isGlass ? '[text-shadow:0_1px_3px_rgba(0,0,0,0.45)]' : '';

  const showTimer = state.taskId !== null && state.isTimerRunning;
  const remaining = showTimer ? Math.max(0, getRemainingTime(state)) : 0;
  const total = state.isBreakTime
    ? state.pomodoroCount % 4 === 0
      ? state.settings.longBreakDuration
      : state.settings.shortBreakDuration
    : state.settings.pomodoroDuration;

  return (
    <div
      className={`fixed inset-0 flex flex-col gap-3 rounded-xl px-3 pb-3 ${surfaceCls} ${textShadowCls}`}
    >
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 select-none items-center justify-end gap-1"
      >
        <div data-tauri-drag-region className="h-8 flex-1 cursor-move" />
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
          onClick={() => void closeFloatWindow()}
          aria-label={t('floatClose')}
          title={t('floatClose')}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        {!showTimer ? (
          <PomodoroFloatEmptyState />
        ) : (
          <>
            <PomodoroProgressRing
              remainingSeconds={remaining}
              totalSeconds={total}
              isBreakTime={state.isBreakTime}
            >
              <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {formatTime(remaining)}
              </span>
            </PomodoroProgressRing>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {state.isBreakTime ? t('onBreak') : state.isPaused ? t('paused') : t('working')}
            </p>
            {!state.isBreakTime && (
              <PomodoroFloatControls
                isPaused={state.isPaused}
                onPause={state.pauseTimer}
                onResume={state.resumeTimer}
                onCheckpoint={() => void requestCheckpoint()}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

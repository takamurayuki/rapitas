/**
 * pomodoroFloatLauncher
 *
 * Shared helper for opening/focusing the Pomodoro floating window. It is the
 * single entry point the header widget and the task-detail quick-nav both call
 * now that the in-app Pomodoro modal is gone — there is no modal to open, so
 * "open Pomodoro" means "bring the float window to the foreground".
 */

import { isTauri } from '@/utils/tauri';
import { createLogger } from '@/lib/logger';
import { usePomodoroStore } from './pomodoro-store';

const logger = createLogger('pomodoro-float-launcher');

/**
 * Brings the Pomodoro floating window to the foreground, creating it if needed.
 * No-op outside Tauri (e.g. browser/Playwright), where there is no float window.
 *
 * @param task - タスク詳細から起動するタスク。渡すと（セッション未稼働時のみ）
 *               フロートのアイドル画面がこのタスクで開始できる状態になる
 */
export async function openPomodoroFloatWindow(task?: { id: number; title: string }): Promise<void> {
  // Sessions are always task-bound and launched from a task's detail page —
  // hand the task over before focusing so the idle screen shows it. Never
  // reassign while a session is running (the running task owns the panel).
  if (task) {
    const state = usePomodoroStore.getState();
    if (!state.isTimerRunning) state.setLastUsedTask(task.id, task.title);
  }
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('focus_pomodoro_float');
  } catch (err) {
    logger.error('Failed to focus pomodoro float window:', err);
  }
}

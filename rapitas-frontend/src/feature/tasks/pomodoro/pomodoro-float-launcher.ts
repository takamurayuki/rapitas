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

const logger = createLogger('pomodoro-float-launcher');

/**
 * Brings the Pomodoro floating window to the foreground, creating it if needed.
 * No-op outside Tauri (e.g. browser/Playwright), where there is no float window.
 */
export async function openPomodoroFloatWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('focus_pomodoro_float');
  } catch (err) {
    logger.error('Failed to focus pomodoro float window:', err);
  }
}

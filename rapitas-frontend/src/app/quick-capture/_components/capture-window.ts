/**
 * capture-window
 *
 * Tauri window helpers shared by the quick-capture forms: environment
 * detection and hiding the frameless popup.
 */

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Hide this popup window (no-op outside Tauri, e.g. opened in a browser tab). */
export async function hideCaptureWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

/** Save-status shared by both capture forms. */
export type CaptureStatus = 'idle' | 'saving' | 'saved' | 'error';

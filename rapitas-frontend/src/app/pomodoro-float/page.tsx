'use client';

/**
 * PomodoroFloatPage
 *
 * Frameless Pomodoro window shown at app startup and focused by the header /
 * task-detail Pomodoro buttons (via focus_pomodoro_float). It is the sole
 * surface for the time-management panel now that the modal is gone. Reads the
 * same usePomodoroStore instance that main uses (synced via
 * BroadcastChannel/localStorage) — no bespoke state plumbing needed here.
 *
 * Because this window is hidden rather than closed, its document outlives
 * every frontend restart; useStaleDocumentReload reloads it on show once the
 * frontend it came from is gone.
 */
import { useEffect } from 'react';
import PomodoroFloatView from './_components/pomodoro-float-view';
import { useStaleDocumentReload } from './_hooks/use-stale-document-reload';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function PomodoroFloatPage() {
  // Shown-but-blank is this window's signature failure: the webview is never
  // destroyed, so a document from before the last frontend restart stays
  // loaded with chunk URLs that no longer resolve.
  useStaleDocumentReload();

  // Theme sync: this window loads once and only shows/hides afterwards, so
  // the load-time theme script goes stale when the user flips the theme in
  // the MAIN window. Re-apply from localStorage on mount and live via the
  // cross-window 'storage' event (same pattern as quick-capture).
  useEffect(() => {
    const applyTheme = () => {
      const stored = localStorage.getItem('theme');
      const dark =
        stored === 'dark' ||
        (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    applyTheme();
    window.addEventListener('storage', applyTheme);
    return () => window.removeEventListener('storage', applyTheme);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      import('@tauri-apps/api/dpi').then(({ LogicalSize }) => {
        getCurrentWindow()
          .setSize(new LogicalSize(400, 640))
          .catch(() => {});
      });
    });
  }, []);

  return <PomodoroFloatView />;
}

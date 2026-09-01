'use client';

/**
 * PomodoroFloatPage
 *
 * Frameless always-on-top Pomodoro popup opened from GlobalPomodoroModal's
 * "show in floating window" toggle. Reads the same usePomodoroStore
 * instance that main uses (synced via BroadcastChannel/localStorage) —
 * no bespoke state plumbing needed here.
 */
import { useEffect } from 'react';
import PomodoroFloatView from './_components/pomodoro-float-view';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function PomodoroFloatPage() {
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
          .setSize(new LogicalSize(300, 380))
          .catch(() => {});
      });
    });
  }, []);

  return <PomodoroFloatView />;
}

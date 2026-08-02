'use client';

/**
 * QuickCapturePage
 *
 * Frameless always-on-top capture popup opened by the desktop global shortcut
 * (default Ctrl+Alt+I) or the tray menu. Hosts two capture modes behind tabs —
 * idea (アイデアボックス) and vocabulary (単語帳) — sharing one shortcut; the
 * last-used mode is remembered. Ctrl+Tab switches modes, Esc (or focus loss)
 * hides the window. Field logic lives in the per-mode form components.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, WalletCards, Info } from 'lucide-react';
import { hideCaptureWindow, isTauri } from './_components/capture-window';
import { IdeaCaptureForm } from './_components/idea-capture-form';
import { VocabCaptureForm } from './_components/vocab-capture-form';

type CaptureMode = 'idea' | 'vocab';
const MODE_KEY = 'rapitas-quick-capture-mode';

// NOTE: must match the Rust-side WebviewWindowBuilder inner_size for fresh
// windows; enforced from here too so an already-built binary (created at an
// older height) still gets the room the fields need.
const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 260;

export default function QuickCapturePage() {
  const t = useTranslations('quickCapture');
  const [mode, setMode] = useState<CaptureMode>('idea');
  // Remount forms (clearing fields/status) each time the popup is re-shown.
  const [sessionKey, setSessionKey] = useState(0);
  // Shared with forms: suppresses blur-to-hide while a save is in flight.
  const savingRef = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === 'vocab' || stored === 'idea') setMode(stored);
  }, []);

  const switchMode = (next: CaptureMode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  };

  // The popup window's size is fixed at creation — resize so layout changes
  // reach binaries built before them.
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      import('@tauri-apps/api/dpi').then(({ LogicalSize }) => {
        getCurrentWindow()
          .setSize(new LogicalSize(WINDOW_WIDTH, WINDOW_HEIGHT))
          .catch(() => {});
      });
    });
  }, []);

  // Re-shown via the global shortcut: fresh capture session (mode is kept).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('quick-capture:show', () => setSessionKey((k) => k + 1)).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
  }, []);

  // Spotlight-like behavior: losing focus dismisses the popup (Tauri only).
  useEffect(() => {
    if (!isTauri()) return;
    const onBlur = () => {
      if (!savingRef.current) void hideCaptureWindow();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // Esc hides; Ctrl+Tab flips between the two modes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void hideCaptureWindow();
      } else if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault();
        switchMode(mode === 'idea' ? 'vocab' : 'idea');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Tab-menu look: bottom-border tabs sitting on a shared hairline.
  const tabCls = (active: boolean) =>
    `-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
      active
        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
        : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    // fixed inset-0 with its own surface so global layout offsets persisted in
    // shared localStorage can't leak into this tiny popup window.
    <div className="fixed inset-0 z-[300] flex flex-col gap-2 bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 px-3 pb-3">
      {/* Tab bar doubles as the window's drag handle (frameless window) —
          data-tauri-drag-region only fires on the elements carrying it, so
          the tab/info buttons inside stay clickable. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 select-none items-end border-b border-zinc-200 dark:border-zinc-700"
      >
        <button onClick={() => switchMode('idea')} className={tabCls(mode === 'idea')}>
          <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
          {t('modeIdea')}
        </button>
        <button onClick={() => switchMode('vocab')} className={tabCls(mode === 'vocab')}>
          <WalletCards className="h-3.5 w-3.5" aria-hidden="true" />
          {t('modeVocab')}
        </button>
        <div data-tauri-drag-region className="h-8 flex-1 cursor-move" />
        {/* Hints live behind a hover tooltip instead of a permanent caption. */}
        <div className="group relative flex items-center self-center pb-1">
          <Info
            className="h-4 w-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            aria-label={t('hintAria')}
          />
          <div className="pointer-events-none absolute right-0 top-full z-10 mt-1.5 hidden w-72 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-600 shadow-lg group-hover:block dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            <p>{mode === 'idea' ? t('hint') : t('vocabHint')}</p>
            <p className="mt-1 text-zinc-400 dark:text-zinc-500">{t('modeSwitchHint')}</p>
          </div>
        </div>
      </div>
      {mode === 'idea' ? (
        <IdeaCaptureForm key={`idea-${sessionKey}`} savingRef={savingRef} />
      ) : (
        <VocabCaptureForm key={`vocab-${sessionKey}`} savingRef={savingRef} />
      )}
    </div>
  );
}

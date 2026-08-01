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
import { Lightbulb, WalletCards } from 'lucide-react';
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

  const tabCls = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    // fixed inset-0 with its own surface so global layout offsets persisted in
    // shared localStorage can't leak into this tiny popup window.
    <div className="fixed inset-0 z-[300] flex flex-col gap-2 bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 p-3">
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={() => switchMode('idea')} className={tabCls(mode === 'idea')}>
          <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
          {t('modeIdea')}
        </button>
        <button onClick={() => switchMode('vocab')} className={tabCls(mode === 'vocab')}>
          <WalletCards className="h-3.5 w-3.5" aria-hidden="true" />
          {t('modeVocab')}
        </button>
        <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
          {t('modeSwitchHint')}
        </span>
      </div>
      {mode === 'idea' ? (
        <IdeaCaptureForm key={`idea-${sessionKey}`} savingRef={savingRef} />
      ) : (
        <VocabCaptureForm key={`vocab-${sessionKey}`} savingRef={savingRef} />
      )}
    </div>
  );
}

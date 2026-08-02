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
import { Lightbulb, WalletCards, ListPlus, Info, Pin, PinOff } from 'lucide-react';
import { hideCaptureWindow, isTauri } from './_components/capture-window';
import { IdeaCaptureForm } from './_components/idea-capture-form';
import { VocabCaptureForm } from './_components/vocab-capture-form';
import { TaskCaptureForm } from './_components/task-capture-form';

type CaptureMode = 'idea' | 'vocab' | 'task';
const MODE_ORDER: CaptureMode[] = ['idea', 'vocab', 'task'];
const MODE_KEY = 'rapitas-quick-capture-mode';
const PIN_KEY = 'rapitas-quick-capture-pinned';

// NOTE: must match the Rust-side WebviewWindowBuilder inner_size for fresh
// windows; enforced from here too so an already-built binary (created at an
// older height) still gets the room the fields need.
const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 290;

export default function QuickCapturePage() {
  const t = useTranslations('quickCapture');
  const [mode, setMode] = useState<CaptureMode>('idea');
  // Remount forms (clearing fields/status) each time the popup is re-shown.
  const [sessionKey, setSessionKey] = useState(0);
  // Shared with forms: suppresses blur-to-hide while a save is in flight.
  const savingRef = useRef(false);
  // Timestamp of the last press on the drag surface. Starting a native window
  // drag blurs the webview, which must NOT hide the popup — and WebView2 also
  // synthesizes a mouseup when the native drag takes over, so a boolean flag
  // cleared on mouseup loses the race. A time window is order-independent.
  const dragArmedAtRef = useRef(0);
  // Pinned: never auto-hide on focus loss (Esc still closes). Persisted.
  const [isPinned, setIsPinned] = useState(false);
  const pinnedRef = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored && (MODE_ORDER as string[]).includes(stored)) setMode(stored as CaptureMode);
    const pinned = localStorage.getItem(PIN_KEY) === 'true';
    setIsPinned(pinned);
    pinnedRef.current = pinned;
  }, []);

  const togglePin = () => {
    setIsPinned((v) => {
      const next = !v;
      pinnedRef.current = next;
      localStorage.setItem(PIN_KEY, String(next));
      return next;
    });
  };

  const switchMode = (next: CaptureMode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  };

  // Theme sync: this window loads once and then only hides/shows, so the
  // load-time theme script goes stale when the user flips the theme in the
  // MAIN window. Re-apply from localStorage on mount, on every re-show, and
  // live via the cross-window 'storage' event.
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
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('quick-capture:show', applyTheme).then((fn) => {
          unlisten = fn;
        });
      });
    }
    return () => {
      window.removeEventListener('storage', applyTheme);
      unlisten?.();
    };
  }, []);

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

  // Spotlight-like behavior: losing focus dismisses the popup (Tauri only) —
  // unless a save is in flight, the window is pinned, or the blur belongs to a
  // window drag. Two guards cover the drag: any blur within a few seconds of a
  // press on the drag surface is ignored, and the hide itself is delayed a
  // beat so a transient blur→focus flicker (e.g. at drag end) cancels it.
  useEffect(() => {
    if (!isTauri()) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const DRAG_GRACE_MS = 5000;
    const onBlur = () => {
      if (savingRef.current || pinnedRef.current) return;
      if (Date.now() - dragArmedAtRef.current < DRAG_GRACE_MS) {
        dragArmedAtRef.current = 0;
        return;
      }
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => void hideCaptureWindow(), 250);
    };
    const onFocus = () => clearTimeout(hideTimer);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Esc hides; Ctrl+Tab flips between the two modes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void hideCaptureWindow();
      } else if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault();
        switchMode(MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]);
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
        onMouseDown={(e) => {
          // Only a press on the drag surface itself (not tabs/buttons inside)
          // arms the blur suppression for the imminent native window drag.
          if ((e.target as HTMLElement).dataset?.tauriDragRegion !== undefined) {
            dragArmedAtRef.current = Date.now();
          }
        }}
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
        <button onClick={() => switchMode('task')} className={tabCls(mode === 'task')}>
          <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('modeTask')}
        </button>
        <div data-tauri-drag-region className="h-8 flex-1 cursor-move" />
        {/* Pin: keep the popup open on focus loss (Esc still closes). */}
        <button
          onClick={togglePin}
          aria-pressed={isPinned}
          aria-label={t(isPinned ? 'unpinAria' : 'pinAria')}
          title={t(isPinned ? 'unpinAria' : 'pinAria')}
          className={`self-center pb-1 transition-colors ${
            isPinned
              ? 'text-indigo-500 dark:text-indigo-400'
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          }`}
        >
          {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
      </div>
      {mode === 'idea' ? (
        <IdeaCaptureForm key={`idea-${sessionKey}`} savingRef={savingRef} />
      ) : mode === 'vocab' ? (
        <VocabCaptureForm key={`vocab-${sessionKey}`} savingRef={savingRef} />
      ) : (
        <TaskCaptureForm key={`task-${sessionKey}`} savingRef={savingRef} />
      )}
      {/* Hints — hover tooltip anchored to the bottom-right corner. */}
      <div className="group absolute bottom-2.5 right-3">
        <Info
          className="h-4 w-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label={t('hintAria')}
        />
        <div className="pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 hidden w-72 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-600 shadow-lg group-hover:block dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <p>{mode === 'idea' ? t('hint') : mode === 'vocab' ? t('vocabHint') : t('taskHint')}</p>
          <p className="mt-1 text-zinc-400 dark:text-zinc-500">{t('modeSwitchHint')}</p>
        </div>
      </div>
    </div>
  );
}

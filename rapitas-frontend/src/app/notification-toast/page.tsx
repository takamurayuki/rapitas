'use client';

/**
 * NotificationToastPage
 *
 * Content of the app's own global toast window (Tauri: frameless,
 * always-on-top, non-focusable, bottom-right). Shows one notification at a
 * time: the first payload arrives via URL query (window creation), later ones
 * via the 'rapitas:toast' event. Auto-hides after a few seconds; hovering
 * pauses the timer; clicking navigates the main window to the link.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, X } from 'lucide-react';

interface ToastPayload {
  title: string;
  body: string;
  link: string | null;
}

const AUTO_HIDE_MS = 8000;

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Play a short two-tone chime via WebAudio — no asset file, and the window's
 * autoplay policy allows it without a user gesture (see main.rs browser args).
 */
const playChime = () => {
  try {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const play = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.05);
    };
    // Gentle ascending fifth — audible but not alarming.
    play(659.25, 0, 0.28); // E5
    play(987.77, 0.16, 0.4); // B5
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* sound is best-effort */
  }
};

/** Dismiss this toast window (no-op outside Tauri). */
const hideToastWindow = async () => {
  if (!inTauri()) return;
  // Parks the window off-screen instead of hide(): tao's show() would steal
  // focus on the next notification, and hidden WebView2s stop navigating.
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('toast_dismiss').catch(() => {});
};

export default function NotificationToastPage() {
  const t = useTranslations('notification');
  const [payload, setPayload] = useState<ToastPayload | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const armAutoHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => void hideToastWindow(), AUTO_HIDE_MS);
  }, []);

  // Initial payload is PULLED via toast_ready once mounted (the window is
  // created hidden; the command reveals it) — a URL query can't carry it
  // (WebviewUrl::App treats the path as a PathBuf) and an emit at creation
  // time races this listener's registration. Later payloads arrive by event.
  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<ToastPayload>('rapitas:toast', (e) => {
        setPayload({ ...e.payload, link: e.payload.link || null });
        playChime();
        armAutoHide();
      }).then((fn) => {
        unlisten = fn;
      });
    });
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<ToastPayload | null>('toast_ready')
        .then((initial) => {
          if (initial) {
            setPayload({ ...initial, link: initial.link || null });
            playChime();
            armAutoHide();
          }
        })
        .catch(() => {});
    });
    // Esc dismisses, same as the × button.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void hideToastWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(hideTimerRef.current);
      window.removeEventListener('keydown', onKey);
      unlisten?.();
    };
  }, [armAutoHide]);

  // Theme sync — this window loads once and then only hides/shows, so follow
  // the main window's stored theme (same approach as the quick-capture popup).
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

  const open = async () => {
    if (!inTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('toast_navigate', { link: payload?.link ?? null }).catch(() => {});
  };

  return (
    // The whole surface is the click target; the timer pauses while hovered.
    <div
      onMouseEnter={() => clearTimeout(hideTimerRef.current)}
      onMouseLeave={armAutoHide}
      className="fixed inset-0 flex select-none items-stretch border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-indigo-dark-900"
    >
      <button onClick={open} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
          <AlarmClock className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {payload?.title ?? ''}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-zinc-600 line-clamp-3 dark:text-zinc-300">
            {payload?.body ?? ''}
          </span>
        </span>
      </button>
      <button
        onClick={() => void hideToastWindow()}
        aria-label={t('close')}
        title={t('close')}
        className="self-start p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

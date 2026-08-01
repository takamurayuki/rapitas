'use client';

/**
 * QuickCapturePage
 *
 * Content of the frameless always-on-top idea-capture popup window opened by
 * the desktop global shortcut (default Ctrl+Alt+I) or the tray menu. A title
 * field plus an optional body: Enter on the title saves immediately (Tab moves
 * to the body), Ctrl+Enter saves from the body. Saving clears the fields but
 * keeps the window open so ideas can be captured back-to-back; Esc (or focus
 * loss) hides it. Not responsible for classification/enrichment — ideas land
 * as 'global' scope, verbatim, and are triaged later in /ideas.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, Check } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// NOTE: must match the Rust-side WebviewWindowBuilder inner_size for fresh
// windows; enforced from here too so an already-built binary (created at the
// old 180px height) still gets the room the body field needs.
const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 240;

/** Hide this popup window (no-op outside Tauri, e.g. opened in a browser tab). */
async function hideWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

export default function QuickCapturePage() {
  const t = useTranslations('quickCapture');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const titleRef = useRef<HTMLInputElement>(null);
  // Suppress the blur-to-hide while the async save is in flight.
  const savingRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // The popup may exist from before the two-field layout (window size is fixed
  // at creation) — resize so the body field is actually visible.
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

  // Re-shown via the global shortcut: reset for a fresh capture.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('quick-capture:show', () => {
        setTitle('');
        setBody('');
        setStatus('idle');
        setTimeout(() => titleRef.current?.focus(), 0);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
  }, []);

  // Spotlight-like behavior: losing focus dismisses the popup (Tauri only —
  // in a browser tab hiding is impossible and blur is meaningless).
  useEffect(() => {
    if (!isTauri()) return;
    const onBlur = () => {
      if (!savingRef.current) void hideWindow();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  const submit = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      const res = await fetch(`${API_BASE_URL}/idea-box`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          // Body is optional — the API requires non-empty content, so fall back
          // to the title (same convention as the /ideas add form).
          content: body.trim() || trimmedTitle,
          scope: 'global',
          priority: 'medium',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Stay open for rapid consecutive captures — clear the fields and refocus
      // the title instead of hiding; the user dismisses with Esc (or by
      // switching away) when the burst is over.
      savingRef.current = false;
      setStatus('saved');
      setTitle('');
      setBody('');
      titleRef.current?.focus();
      // Fade the checkmark after a beat so the next save reads as fresh.
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      // Keep the text so the thought is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [title, body]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        void hideWindow();
      }
    },
    [submit],
  );

  const handleBodyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        void hideWindow();
      }
    },
    [submit],
  );

  return (
    // fixed inset-0 with its own surface so global layout offsets (nav pin,
    // split-mode paddings persisted in shared localStorage) can't leak into
    // this tiny popup window.
    <div className="fixed inset-0 z-[300] flex flex-col gap-2 bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 p-3">
      {/* Title row — flat, separated from the body block by a hairline divider. */}
      <div className="flex items-center gap-2.5 border-b border-zinc-200 dark:border-zinc-700 pb-2">
        <Lightbulb className="w-5 h-5 shrink-0 text-amber-500" aria-hidden="true" />
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          placeholder={t('placeholder')}
          aria-label={t('titleAria')}
          className="flex-1 bg-transparent text-base font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
        />
      </div>
      {/* Body — subtle-fill interactive block (surface system §8-2) so the
          optional details area reads as its own input, distinct from the title. */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleBodyKeyDown}
        placeholder={t('bodyPlaceholder')}
        aria-label={t('bodyAria')}
        className="flex-1 min-h-0 resize-none rounded-lg bg-zinc-50 dark:bg-zinc-800/60 ml-8 px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      />
      <div className="shrink-0 flex items-center justify-between pl-8 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{t('hint')}</span>
        {status === 'saving' && <span>{t('saving')}</span>}
        {status === 'saved' && (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            {t('saved')}
          </span>
        )}
        {status === 'error' && (
          <span className="text-red-600 dark:text-red-400">{t('failed')}</span>
        )}
      </div>
    </div>
  );
}

'use client';

/**
 * QuickCapturePage
 *
 * Content of the frameless always-on-top idea-capture popup window opened by
 * the desktop global shortcut (default Ctrl+Alt+I) or the tray menu. One
 * textarea: Enter saves straight into the idea box, Esc hides the window.
 * Not responsible for classification/enrichment — ideas land as 'global'
 * scope and are triaged later in /ideas.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, Check } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Hide this popup window (no-op outside Tauri, e.g. opened in a browser tab). */
async function hideWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

export default function QuickCapturePage() {
  const t = useTranslations('quickCapture');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Suppress the blur-to-hide while the async save is in flight.
  const savingRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Re-shown via the global shortcut: reset for a fresh capture.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('quick-capture:show', () => {
        setText('');
        setStatus('idle');
        setTimeout(() => textareaRef.current?.focus(), 0);
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
    const trimmed = text.trim();
    if (!trimmed || savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      const [firstLine] = trimmed.split('\n');
      const res = await fetch(`${API_BASE_URL}/idea-box`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: firstLine.trim(),
          content: trimmed,
          scope: 'global',
          priority: 'medium',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('saved');
      setText('');
      // Let the checkmark register visually before the window disappears.
      setTimeout(() => {
        savingRef.current = false;
        void hideWindow();
        setStatus('idle');
      }, 450);
    } catch {
      // Keep the text so the thought is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
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
    <div className="fixed inset-0 z-[300] flex flex-col bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 p-3">
      <div className="flex items-start gap-2.5 flex-1 min-h-0">
        <Lightbulb className="w-5 h-5 shrink-0 mt-1.5 text-amber-500" aria-hidden="true" />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('placeholder')}
          rows={3}
          className="flex-1 h-full resize-none bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
        />
      </div>
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

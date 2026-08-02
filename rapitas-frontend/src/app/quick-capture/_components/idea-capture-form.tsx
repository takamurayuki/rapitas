'use client';

/**
 * IdeaCaptureForm
 *
 * Idea mode of the quick-capture popup: title (Enter saves) + optional body
 * (Ctrl+Enter saves). Saving keeps the window open with cleared fields for
 * back-to-back capture. Ideas land verbatim as 'global' scope.
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { CaptureStatusBar } from './capture-status-bar';
import type { CaptureStatus } from './capture-window';

interface IdeaCaptureFormProps {
  /** Shared with the page's blur-to-hide guard. / blur時非表示の抑止フラグ。 */
  savingRef: MutableRefObject<boolean>;
}

/**
 * Render the idea capture fields.
 *
 * @param props - Shared saving flag. / 保存中フラグ。
 */
export function IdeaCaptureForm({ savingRef }: IdeaCaptureFormProps) {
  const t = useTranslations('quickCapture');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const titleRef = useRef<HTMLInputElement>(null);

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
      // Stay open for rapid consecutive captures.
      savingRef.current = false;
      setStatus('saved');
      setTitle('');
      setBody('');
      titleRef.current?.focus();
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      // Keep the text so the thought is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [title, body, savingRef]);

  return (
    <>
      {/* Title row — flat and flush-left, divided from the body by a hairline. */}
      <div className="border-b border-zinc-200 dark:border-zinc-700 pb-2">
        <input
          ref={titleRef}
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t('placeholder')}
          aria-label={t('titleAria')}
          className="w-full bg-transparent text-base font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
        />
      </div>
      {/* Body — subtle-fill interactive block so it reads as its own input. */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={t('bodyPlaceholder')}
        aria-label={t('bodyAria')}
        className="flex-1 min-h-0 resize-none rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
      />
      <CaptureStatusBar status={status} />
    </>
  );
}

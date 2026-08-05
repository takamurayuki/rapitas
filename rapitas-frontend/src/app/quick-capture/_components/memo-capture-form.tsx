'use client';

/**
 * MemoCaptureForm
 *
 * Memo mode of the quick-capture popup: one free-text field (Enter saves,
 * Shift+Enter for a newline) plus an optional reminder picked from quick
 * chips or a custom datetime. Saving keeps the window open with cleared
 * fields for back-to-back capture.
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { presetToDate, REMINDER_PRESET_ORDER, type ReminderPreset } from '@/utils/reminder-presets';
import { CaptureStatusBar } from './capture-status-bar';
import type { CaptureStatus } from './capture-window';

interface MemoCaptureFormProps {
  /** Shared with the page's blur-to-hide guard. / blur時非表示の抑止フラグ。 */
  savingRef: MutableRefObject<boolean>;
}

/**
 * Render the memo capture fields.
 *
 * @param props - Shared saving flag. / 保存中フラグ。
 */
export function MemoCaptureForm({ savingRef }: MemoCaptureFormProps) {
  const t = useTranslations('quickCapture.memo');
  const [content, setContent] = useState('');
  const [preset, setPreset] = useState<ReminderPreset>('none');
  const [custom, setCustom] = useState('');
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || savingRef.current) return;
    const remindAt = presetToDate(preset, custom);
    if (preset === 'custom' && (!remindAt || isNaN(remindAt.getTime()))) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      const res = await fetch(`${API_BASE_URL}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: trimmed,
          remindAt: remindAt ? remindAt.toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Stay open for rapid consecutive captures.
      savingRef.current = false;
      setStatus('saved');
      setContent('');
      setPreset('none');
      setCustom('');
      contentRef.current?.focus();
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      // Keep the text so the record is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [content, preset, custom, savingRef]);

  const chipCls = (selected: boolean) =>
    `whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors ${
      selected
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    <>
      <textarea
        ref={contentRef}
        autoFocus
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={t('placeholder')}
        aria-label={t('contentAria')}
        className="flex-1 min-h-0 resize-none rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
      />
      {/* Reminder row — presets as chips, custom reveals a datetime input. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <AlarmClock
          className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
          aria-label={t('reminderAria')}
        />
        {REMINDER_PRESET_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            className={chipCls(preset === p)}
          >
            {t(`presets.${p}`)}
          </button>
        ))}
        {preset === 'custom' && (
          <input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label={t('customAria')}
            className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs text-zinc-700 outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
        )}
      </div>
      <CaptureStatusBar status={status} />
    </>
  );
}

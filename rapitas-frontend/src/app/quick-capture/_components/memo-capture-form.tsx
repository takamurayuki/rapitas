'use client';

/**
 * MemoCaptureForm
 *
 * Memo mode of the quick-capture popup: reminder row (presets + easy custom
 * day/time picker) above one free-text field (Enter saves, Shift+Enter for a
 * newline). Saving keeps the window open with cleared fields for
 * back-to-back capture.
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { isImeComposing } from '@/utils/ime';
import { emptyReminder, resolveReminder, type ReminderValue } from '@/utils/reminder-presets';
import { ReminderPicker } from '@/components/ui/reminder/reminder-picker';
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
  const [reminder, setReminder] = useState<ReminderValue>(emptyReminder());
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || savingRef.current) return;
    const remindAt = resolveReminder(reminder);
    if (remindAt === 'invalid') return;
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
      setReminder(emptyReminder());
      contentRef.current?.focus();
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      // Keep the text so the record is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [content, reminder, savingRef]);

  return (
    <>
      {/* Reminder row ABOVE the text field — 通知の有無 is decided before typing. */}
      <ReminderPicker value={reminder} onChange={setReminder} />
      <textarea
        ref={contentRef}
        autoFocus
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={t('placeholder')}
        aria-label={t('contentAria')}
        className="flex-1 min-h-0 resize-none rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
      />
      <CaptureStatusBar status={status} />
    </>
  );
}

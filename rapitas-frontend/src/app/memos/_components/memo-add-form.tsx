'use client';

/**
 * MemoAddForm
 *
 * Compact add box for the /memos page (browser-side counterpart of the
 * quick-capture メモモード): content textarea + the shared reminder presets.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, Plus } from 'lucide-react';
import { presetToDate, REMINDER_PRESET_ORDER, type ReminderPreset } from '@/utils/reminder-presets';

interface MemoAddFormProps {
  onAdd: (content: string, remindAt: Date | null) => Promise<boolean>;
}

/**
 * Render the add-memo box.
 *
 * @param props - Save handler from useMemos. / 追加ハンドラ。
 */
export function MemoAddForm({ onAdd }: MemoAddFormProps) {
  const t = useTranslations('memos.add');
  const tp = useTranslations('quickCapture.memo.presets');
  const [content, setContent] = useState('');
  const [preset, setPreset] = useState<ReminderPreset>('none');
  const [custom, setCustom] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    if (!content.trim() || isSaving) return;
    const remindAt = presetToDate(preset, custom);
    if (preset === 'custom' && (!remindAt || isNaN(remindAt.getTime()))) return;
    setIsSaving(true);
    const ok = await onAdd(content, remindAt);
    setIsSaving(false);
    if (ok) {
      setContent('');
      setPreset('none');
      setCustom('');
    }
  };

  const chipCls = (selected: boolean) =>
    `whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors ${
      selected
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
      {/* Reminder row above the input — 通知の有無 is decided before typing
          (mirrors the quick-capture memo form layout). */}
      <div className="flex flex-wrap items-center gap-1.5">
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
            {tp(p)}
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
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
        rows={2}
        placeholder={t('placeholder')}
        aria-label={t('contentAria')}
        className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={!content.trim() || isSaving}
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {t('save')}
        </button>
      </div>
    </div>
  );
}

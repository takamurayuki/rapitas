'use client';

/**
 * MemoAddForm
 *
 * Compact add box for the /memos page (browser-side counterpart of the
 * quick-capture メモモード): shared reminder picker above a content textarea.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { isImeComposing } from '@/utils/ime';
import { emptyReminder, resolveReminder, type ReminderValue } from '@/utils/reminder-presets';
import { ReminderPicker } from '@/components/ui/reminder/reminder-picker';

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
  const [content, setContent] = useState('');
  const [reminder, setReminder] = useState<ReminderValue>(emptyReminder());
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    if (!content.trim() || isSaving) return;
    const remindAt = resolveReminder(reminder);
    if (remindAt === 'invalid') return;
    setIsSaving(true);
    const ok = await onAdd(content, remindAt);
    setIsSaving(false);
    if (ok) {
      setContent('');
      setReminder(emptyReminder());
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
      {/* Reminder row above the input — 通知の有無 is decided before typing
          (mirrors the quick-capture memo form layout). */}
      <ReminderPicker value={reminder} onChange={setReminder} />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) {
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

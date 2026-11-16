'use client';
/**
 * AddMilestoneForm
 *
 * Adds a milestone (節目) to a goal: a name and an optional target date. The
 * 達成条件 are written on the card afterwards.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Renders the add-milestone row.
 *
 * @param onAdd - Creates the milestone; resolves to an error or null / 節目を追加する
 */
export function AddMilestoneForm({
  onAdd,
}: {
  onAdd: (name: string, dueDate: string | null) => Promise<string | null>;
}) {
  const t = useTranslations('goals');
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const failure = await onAdd(name.trim(), dueDate || null);
        setBusy(false);
        setError(failure);
        if (!failure) {
          setName('');
          setDueDate('');
        }
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('milestone.namePlaceholder')}
        aria-label={t('milestone.nameLabel')}
        maxLength={200}
        className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        aria-label={t('milestone.dueLabel')}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {t('milestone.add')}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

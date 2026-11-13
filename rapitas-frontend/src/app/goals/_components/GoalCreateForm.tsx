'use client';
/**
 * GoalCreateForm
 *
 * Adds a goal: a short name and, optionally, what achieving it looks like.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface GoalCreateFormProps {
  onCreate: (name: string, description: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Renders the inline goal creation form.
 *
 * @param onCreate - Creates the goal / ゴールを作成する
 * @param onCancel - Closes the form / フォームを閉じる
 */
export function GoalCreateForm({ onCreate, onCancel }: GoalCreateFormProps) {
  const t = useTranslations('goals');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await onCreate(name.trim(), description.trim());
        } finally {
          setBusy(false);
        }
      }}
      className="mb-6 space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-indigo-dark-900"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('create.namePlaceholder')}
        aria-label={t('create.nameLabel')}
        maxLength={200}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('create.descriptionPlaceholder')}
        aria-label={t('create.descriptionLabel')}
        rows={2}
        maxLength={2000}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {t('create.submit')}
        </button>
      </div>
    </form>
  );
}

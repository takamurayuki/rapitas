'use client';
/**
 * MilestoneCriteriaEditor
 *
 * Edits a milestone's 達成条件 — what must be true for it to count as
 * reached. One criterion per line; at most 10, like task criteria.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

const MAX_CRITERIA = 10;

interface MilestoneCriteriaEditorProps {
  initial: string[];
  /** Saves the list; resolves to an error sentence, or null on success. */
  onSave: (criteria: string[]) => Promise<string | null>;
  onCancel: () => void;
}

/**
 * Renders the criteria editor.
 *
 * @param initial - Current criteria / 現在の達成条件
 * @param onSave - Saves the edited list / 保存処理
 * @param onCancel - Leaves without saving / 編集をやめる
 */
export function MilestoneCriteriaEditor({
  initial,
  onSave,
  onCancel,
}: MilestoneCriteriaEditorProps) {
  const t = useTranslations('goals');
  const [text, setText] = useState(initial.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(Math.max(lines.length + 1, 3), 10)}
        aria-label={t('criteria.editLabel')}
        placeholder={t('criteria.placeholder')}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t('criteria.hint', { max: MAX_CRITERIA })}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          disabled={busy || lines.length > MAX_CRITERIA}
          onClick={async () => {
            setBusy(true);
            const failure = await onSave(lines);
            setBusy(false);
            if (failure) setError(failure);
          }}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {t('criteria.save')}
        </button>
      </div>
    </div>
  );
}

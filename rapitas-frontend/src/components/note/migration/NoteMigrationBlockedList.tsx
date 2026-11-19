'use client';
/**
 * NoteMigrationBlockedList
 *
 * The PC notes the server would not take because another workspace already
 * holds their id (`conflictIds` of `/notes/import`). They are not on the
 * server, so the migration is not finished and this PC keeps showing its own
 * notes. Draws only; the retry comes from the parent.
 */
import { useTranslations } from 'next-intl';
import type { BlockedNote } from './note-migration-runner';

interface Props {
  blocked: BlockedNote[];
  /** Shown only when nothing else on the band can move the migration on. */
  onRetry?: () => void;
}

/**
 * The list of notes that cannot be moved.
 *
 * @param blocked - Notes whose id another workspace holds / 別のワークスペースがIDを持つノート
 * @param onRetry - Check again, when there is nothing else to decide / 再確認（他に判断が無いとき）
 */
export default function NoteMigrationBlockedList({ blocked, onRetry }: Props) {
  const t = useTranslations('notes.migration');
  return (
    <div className="mt-1 space-y-1.5" data-testid="note-migration-blocked">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {t('blockedTitle', { count: blocked.length })}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('blockedHint')}</p>
      <ul className="list-disc pl-5 text-xs text-zinc-700 dark:text-zinc-300">
        {blocked.map((note) => (
          <li key={note.id}>
            {note.title || t('untitled')}
            <span className="ml-1 text-zinc-400 dark:text-zinc-500">({note.id})</span>
          </li>
        ))}
      </ul>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200"
        >
          {t('blockedRetry')}
        </button>
      )}
    </div>
  );
}

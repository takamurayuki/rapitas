'use client';

/**
 * GoalReflectionModal
 *
 * The short weekly 前進の振り返り: per goal in progress, pick 1-5 and write an
 * optional note. Opened from the weekly nudge notification; this week's saved
 * record is shown again so it can be corrected. Not responsible for fetching
 * (see useGoalReflection).
 */
import { MessageSquareHeart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal/Modal';
import { useGoalReflectionModalStore } from './goal-reflection-store';
import { useGoalReflection, type ReflectionRowState } from './useGoalReflection';
import { noteLength, REFLECTION_NOTE_MAX } from './goal-reflection-week';

const RATINGS = [1, 2, 3, 4, 5] as const;

function GoalRow({
  row,
  onRating,
  onNote,
}: {
  row: ReflectionRowState;
  onRating: (goalId: number, rating: number) => void;
  onNote: (goalId: number, note: string) => void;
}) {
  const t = useTranslations('goalReflection');
  const count = noteLength(row.note);
  const tooLong = count > REFLECTION_NOTE_MAX;
  return (
    <li className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {row.goal.name}
        </span>
        {row.saved && !row.dirty && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">{t('saved')}</span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={t('ratingLabel', { name: row.goal.name })}
        className="flex gap-2"
      >
        {RATINGS.map((value) => {
          const selected = row.rating === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onRating(row.goal.id, value)}
              className={
                selected
                  ? 'h-9 w-9 rounded-full border border-violet-600 bg-violet-600 text-sm font-medium text-white transition-colors'
                  : 'h-9 w-9 rounded-full border border-zinc-300 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }
            >
              {t('ratingOption', { value })}
            </button>
          );
        })}
      </div>
      <textarea
        value={row.note}
        onChange={(e) => onNote(row.goal.id, e.target.value)}
        placeholder={t('notePlaceholder')}
        rows={2}
        aria-label={t('notePlaceholder')}
        className="w-full resize-none rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <p
        className={
          tooLong
            ? 'text-right text-xs text-red-600 dark:text-red-400'
            : 'text-right text-xs text-zinc-400 dark:text-zinc-500'
        }
      >
        {t('noteCount', { count, max: REFLECTION_NOTE_MAX })}
      </p>
    </li>
  );
}

/** The weekly reflection modal, mounted once (in the notification bell). */
export default function GoalReflectionModal() {
  const t = useTranslations('goalReflection');
  const isOpen = useGoalReflectionModalStore((s) => s.isOpen);
  const close = useGoalReflectionModalStore((s) => s.close);
  const { rows, status, failed, setRating, setNote, save, canSave } = useGoalReflection(isOpen);

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title={t('title')}
      icon={<MessageSquareHeart className="h-5 w-5" aria-hidden="true" />}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('close')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave || status === 'saving'}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {status === 'saving' ? t('saving') : t('save')}
          </button>
        </div>
      }
    >
      <p className="mb-1 text-sm text-zinc-600 dark:text-zinc-300">{t('intro')}</p>
      <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">{t('ratingScale')}</p>
      {status === 'loading' && <p className="text-sm text-zinc-500">{t('loading')}</p>}
      {failed === 'load' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('loadFailed')}
        </p>
      )}
      {status !== 'loading' && failed !== 'load' && rows.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noGoals')}</p>
      )}
      <ul className="space-y-3">
        {rows.map((row) => (
          <GoalRow key={row.goal.id} row={row} onRating={setRating} onNote={setNote} />
        ))}
      </ul>
      {failed === 'save' && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {t('saveFailed')}
        </p>
      )}
      {status === 'savedAll' && (
        <p role="status" className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
          {t('savedAll')}
        </p>
      )}
    </Modal>
  );
}

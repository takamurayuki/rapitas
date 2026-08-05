'use client';

/**
 * MemoRow
 *
 * One memo in the /memos list: done toggle, content, reminder badge
 * (upcoming = tinted, fired = muted), created date, delete.
 */
import { useTranslations, useFormatter } from 'next-intl';
import { AlarmClock, Check, Trash2 } from 'lucide-react';
import type { Memo } from './memo.types';

interface MemoRowProps {
  memo: Memo;
  onToggleDone: (memo: Memo) => void;
  onDelete: (memo: Memo) => void;
}

/**
 * Render one memo row.
 *
 * @param props - Memo and its handlers. / メモと操作ハンドラ。
 */
export function MemoRow({ memo, onToggleDone, onDelete }: MemoRowProps) {
  const t = useTranslations('memos.row');
  const format = useFormatter();

  const remind = memo.remindAt ? new Date(memo.remindAt) : null;
  const fired = memo.remindedAt != null;
  const reminderCls = fired
    ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500'
    : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';

  return (
    <div
      className={`flex items-start gap-2.5 border-b border-zinc-100 px-1 py-2.5 dark:border-zinc-800 ${
        memo.isDone ? 'opacity-60' : ''
      }`}
    >
      <button
        onClick={() => onToggleDone(memo)}
        aria-pressed={memo.isDone}
        aria-label={t(memo.isDone ? 'markOpen' : 'markDone')}
        title={t(memo.isDone ? 'markOpen' : 'markDone')}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
          memo.isDone
            ? 'border-green-500 bg-green-500 text-white'
            : 'border-zinc-300 text-transparent hover:border-green-400 hover:text-green-400 dark:border-zinc-600'
        }`}
      >
        <Check className="h-3 w-3" />
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={`whitespace-pre-line break-words text-sm text-zinc-800 dark:text-zinc-200 ${
            memo.isDone ? 'line-through' : ''
          }`}
        >
          {memo.content}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
          <span>{format.dateTime(new Date(memo.createdAt), { dateStyle: 'medium' })}</span>
          {remind && (
            <span
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${reminderCls}`}
            >
              <AlarmClock className="h-3 w-3" aria-hidden="true" />
              {format.dateTime(remind, { dateStyle: 'medium', timeStyle: 'short' })}
              {fired && ` ${t('reminded')}`}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={() => onDelete(memo)}
        aria-label={t('delete')}
        title={t('delete')}
        className="mt-0.5 shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

'use client';
/**
 * TaskIntake
 *
 * ラピ's first way of taking input: say what you want to do, see what it
 * understood, file it if that is right.
 *
 * Two steps on purpose. Nothing is created by describing something — the
 * draft is a proposal, and `TaskDraftCard` is where it becomes an act.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { isImeComposing } from '@/utils/ime';
import { TaskDraftCard } from './TaskDraftCard';
import { useTaskDraft } from './use-task-draft';

/** Where a freshly filed task can be opened. Headered, per the task-link rule. */
const filedTaskHref = (id: number) => `/tasks/${id}?showHeader=true`;

export function TaskIntake() {
  const t = useTranslations('rapiAvatar.intake');
  const [text, setText] = useState('');
  const {
    draft,
    source,
    edited,
    proposing,
    filing,
    error,
    filedTaskId,
    fileable,
    propose,
    edit,
    file,
    reset,
  } = useTaskDraft();

  const submit = async () => {
    await propose(text);
  };

  const discard = () => {
    reset();
    setText('');
  };

  return (
    <section className="space-y-2 border-b border-zinc-200 p-2 dark:border-zinc-700">
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('title')}</h3>

      {!draft && (
        <>
          <textarea
            rows={2}
            value={text}
            placeholder={t('placeholder')}
            aria-label={t('title')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits, Shift+Enter breaks the line. Guarded against
              // IME: the Enter that commits a Japanese conversion must not
              // also send the text.
              if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e.nativeEvent)) {
                e.preventDefault();
                void submit();
              }
            }}
            className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim() || proposing}
            className="w-full rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950"
          >
            {proposing ? t('proposing') : t('propose')}
          </button>
        </>
      )}

      {/* A fallback draft is visibly weaker — fields were pattern-matched
          rather than understood — and the user should know before trusting
          it. */}
      {draft && source === 'patterns' && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400">{t('fellBackToPatterns')}</p>
      )}

      {draft && edited && (
        <TaskDraftCard
          draft={draft}
          edited={edited}
          fileable={fileable}
          filing={filing}
          onEdit={edit}
          onFile={() => void file()}
          onDiscard={discard}
        />
      )}

      {filedTaskId !== null && (
        <p className="flex items-center gap-2 text-[11px] text-emerald-700 dark:text-emerald-400">
          {t('filed')}
          <a href={filedTaskHref(filedTaskId)} className="underline">
            {t('openFiled')}
          </a>
        </p>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{t('error')}</p>}
    </section>
  );
}

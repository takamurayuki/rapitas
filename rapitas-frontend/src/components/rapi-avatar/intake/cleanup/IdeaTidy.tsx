'use client';
/**
 * IdeaTidy
 *
 * Tidying the idea box with ラピ: near-duplicate ideas gathered under the one
 * kept, and ideas no longer needed (already a task, or old and low
 * priority). Nothing changes until the button is pressed, only what is still
 * ticked is applied, and it can be undone. Not responsible for the proposal
 * rules (server) or its state (`useIdeaTidy`).
 *
 * Two ways of proposing, like the task tidy: the rules (instant), and
 * おまかせ, where the model reads the ideas and finds the same idea in
 * different words — what the rules missed in the real idea box (2026-11-17).
 */
import { useTranslations } from 'next-intl';
import { Eraser, Undo2 } from 'lucide-react';
import { useIdeaTidy, type IdeaTidyMode } from './use-idea-tidy';

export function IdeaTidy() {
  const t = useTranslations('rapiAvatar.ideaTidy');
  const s = useIdeaTidy();
  const chosenCount = s.duplicates.filter((g) => s.groupsOn.has(g.keepId)).length + s.ideasOn.size;
  const nothing = !s.loading && s.available && s.duplicates.length === 0 && s.unneeded.length === 0;

  const chip = (value: IdeaTidyMode, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => s.setMode(value)}
      aria-pressed={s.mode === value}
      disabled={s.loading || s.working}
      className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
        s.mode === value
          ? 'bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="space-y-2 p-2">
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('title')}</h3>
      <div className="flex items-center gap-1.5">
        {chip('rules', t('byCondition'))}
        {chip('judgement', t('byJudgement'))}
      </div>
      <p className="text-[10px] text-zinc-400">
        {s.mode === 'rules' ? t('conditionHint') : t('judgementHint')}
      </p>

      {s.loading && (
        <p className="text-[11px] text-zinc-500">
          {s.mode === 'judgement' ? t('reading') : t('looking')}
        </p>
      )}
      {!s.loading && !s.available && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{t('unavailable')}</p>
      )}
      {nothing && !s.error && (
        <p className="text-[11px] text-zinc-500">
          {s.mode === 'rules' ? t('nothingTryJudgement') : t('nothing')}
        </p>
      )}
      {!s.loading && s.considered !== null && (
        <p className="text-[10px] text-zinc-400">{t('considered', { count: s.considered })}</p>
      )}

      {!s.loading && !s.done && !nothing && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
          {s.duplicates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                {t('duplicates')}
              </p>
              <ul className="space-y-1.5">
                {s.duplicates.map((g) => {
                  const keep = g.ideas.find((i) => i.id === g.keepId);
                  const others = g.ideas.filter((i) => i.id !== g.keepId);
                  return (
                    <li
                      key={g.keepId}
                      data-idea-group={g.keepId}
                      className="flex items-start gap-2"
                    >
                      <input
                        type="checkbox"
                        checked={s.groupsOn.has(g.keepId)}
                        onChange={() => s.toggleGroup(g.keepId)}
                        aria-label={keep?.title ?? String(g.keepId)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-zinc-800 dark:text-zinc-100">
                          {keep?.title}
                        </span>
                        {g.reason && (
                          <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                            {g.reason}
                          </span>
                        )}
                        {others.map((o) => (
                          <span key={o.id} className="block truncate text-[10px] text-zinc-400">
                            {t('mergeInto', { title: o.title })}
                          </span>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {s.unneeded.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                {t('unneeded')}
              </p>
              <ul className="space-y-1.5">
                {s.unneeded.map((u) => (
                  <li key={u.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={s.ideasOn.has(u.id)}
                      onChange={() => s.toggleIdea(u.id)}
                      aria-label={u.title}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-zinc-800 dark:text-zinc-100">
                        {u.title}
                      </span>
                      <span className="block text-[10px] text-zinc-400">
                        {u.reason === 'judged' && u.note ? u.note : t(`reason.${u.reason}`)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.unclear.length > 0 && (
            <ul className="list-inside list-disc">
              {s.unclear.map((u) => (
                <li key={u} className="text-[10px] text-amber-700 dark:text-amber-400">
                  {u}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => void s.apply()}
            disabled={chosenCount === 0 || s.working}
            className="flex w-full items-center justify-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            {s.working ? t('working') : t('apply', { count: chosenCount })}
          </button>
          <p className="text-[10px] text-zinc-400">{t('note')}</p>
        </div>
      )}

      {s.done && (
        <div className="space-y-1.5 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-700 dark:text-zinc-200">
            {s.undone
              ? t('undone')
              : t('done', {
                  merged: s.done.previousContents.length,
                  archived: s.done.archivedIds.length,
                })}
          </p>
          {!s.undone && (
            <button
              type="button"
              onClick={() => void s.undo()}
              disabled={s.working}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('undo')}
            </button>
          )}
        </div>
      )}

      {s.error && <p className="text-[11px] text-red-600 dark:text-red-400">{t('error')}</p>}
    </section>
  );
}

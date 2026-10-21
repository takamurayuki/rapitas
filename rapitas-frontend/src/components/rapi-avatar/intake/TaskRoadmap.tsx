'use client';
/**
 * TaskRoadmap
 *
 * Talking something over with ラピ until it is a set of tasks.
 *
 * Two rounds, not a conversation. She has no memory between messages, so
 * the first round asks everything it needs at once — two to four choices
 * and a recommendation, the same rule the workflow's own `question.md`
 * follows — and the second round is handed the answers and plans against
 * them.
 *
 * It was one round until the answers were found to change nothing: the plan
 * was already drafted when the questions were answered, so whichever option
 * was picked, the same tasks were created and the choice reached only the
 * note. Hence `refine`, and hence no create button while questions are
 * unanswered — offering to create the sketch is what made the interview
 * decorative.
 *
 * Nothing is created until the plan has been read. The draft call writes
 * nothing at all, and the commit call runs no model: what gets made is what
 * was on screen. That split is why a model is allowed to invent the plan in
 * the first place.
 *
 * The closing note is written here rather than on the server. Notes in this
 * app live in the browser's own storage with no table behind them, so the
 * client composes it from the goal, the answers and the tasks that were
 * created — which is also the only place all three are known at once.
 */
import { useTranslations } from 'next-intl';
import { useRoadmap, type Placement } from './use-roadmap';

export interface TaskRoadmapProps {
  /** What the user asked for, handed over by the single input. */
  handedOver?: string;
}

export function TaskRoadmap({ handedOver }: TaskRoadmapProps = {}) {
  const t = useTranslations('rapiAvatar.roadmap');
  const {
    draft,
    asked,
    answers,
    setAnswers,
    drafting,
    committing,
    committed,
    failed,
    unavailable,
    unanswered,
    refine,
    commit,
  } = useRoadmap(handedOver);

  const placement = (p: Placement) =>
    p.kind === 'none' ? t('noProject') : `${p.name ?? '—'}${p.kind === 'new' ? t('isNew') : ''}`;

  return (
    <section className="space-y-2 p-2">
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('title')}</h3>

      {drafting && <p className="text-[11px] text-zinc-400">{t('thinking')}</p>}
      {unavailable && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{t('unavailable')}</p>
      )}
      {failed && <p className="text-[11px] text-red-600 dark:text-red-400">{t('failed')}</p>}

      {draft && !committed && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">{draft.goal}</p>

          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {t('placement', {
              theme: placement(draft.themeChoice),
              project: placement(draft.projectChoice),
            })}
          </p>

          {asked.map((q, i) => (
            <div key={q.question} className="space-y-1">
              <p className="text-[11px] text-zinc-700 dark:text-zinc-200">{q.question}</p>
              <div className="flex flex-wrap gap-1">
                {q.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [i]: o }))}
                    aria-pressed={answers[i] === o}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                      answers[i] === o
                        ? 'bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
              {/* Why she would pick that one. Without it the recommendation
                  is an assertion rather than an argument. */}
              {q.recommendedReason && (
                <p className="text-[10px] text-zinc-400">{q.recommendedReason}</p>
              )}
            </div>
          ))}

          {/* What she worked back from, when the request named a date. */}
          {draft.deadline && (
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {t('deadline', { date: draft.deadline })}
            </p>
          )}

          <ul className="max-h-52 space-y-1 overflow-y-auto">
            {draft.steps.map((s) => (
              <li
                key={s.title}
                className="rounded border border-zinc-200 p-1.5 dark:border-zinc-700"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                    {s.title}
                  </span>
                  {s.dueDate && (
                    <span className="shrink-0 text-[10px] text-zinc-400">{s.dueDate}</span>
                  )}
                </span>
                <span className="block whitespace-pre-wrap text-[10px] text-zinc-500 dark:text-zinc-400">
                  {s.description}
                </span>
              </li>
            ))}
          </ul>

          {/* Unanswered questions mean this plan is a sketch. Creating it is
              what made the interview decorative, so that is not offered. */}
          {unanswered ? (
            <button
              type="button"
              onClick={refine}
              disabled={drafting}
              className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {t('refine')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void commit()}
              disabled={committing}
              className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {committing ? t('creating') : t('create', { count: draft.steps.length })}
            </button>
          )}
        </div>
      )}

      {committed && (
        <div className="space-y-1 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-700 dark:text-zinc-200">
            {t('created', { count: committed.taskIds.length })}
          </p>
          {/* Half a roadmap is worse than none if nobody says which half. */}
          {committed.failedAfter !== null && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              {t('stoppedAfter', { count: committed.failedAfter })}
            </p>
          )}
          <p className="text-[10px] text-zinc-400">{t('noteWritten')}</p>
        </div>
      )}
    </section>
  );
}

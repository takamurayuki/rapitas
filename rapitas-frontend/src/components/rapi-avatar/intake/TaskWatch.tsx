'use client';
/**
 * TaskWatch
 *
 * ラピ looking over the whole backlog and saying what needs a hand.
 *
 * Every number here was counted by the database — no model is in the path —
 * so she can be asked the wrong question but cannot be confidently wrong
 * about how many tasks are stuck.
 *
 * This is the reading half of a supervisor's job and deliberately all of it
 * for now. Whether her judgement is worth acting on is measurable: if she
 * flags twenty and two get acted on, the conditions are wrong rather than the
 * permissions, and that is worth knowing before she is allowed to retry
 * anything. Acting would also have to settle who wins when the existing
 * watchers disagree with her.
 *
 * Changes nothing. The only thing a click does is open a task.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rapi-watch');

interface WatchedTask {
  id: number;
  title: string;
  status: string;
  themeId: number | null;
  dueDate: string | null;
  updatedAt: string;
}

interface Finding {
  category: string;
  total: number;
  tasks: WatchedTask[];
}

interface Survey {
  total: number;
  categories: Finding[];
}

/** Where a task opens from here. Headered, per the task-link rule. */
const taskHref = (id: number) => `/tasks/${id}?showHeader=true`;

/** How long ago, in whole days, as a number the caller can phrase. */
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export function TaskWatch() {
  const t = useTranslations('rapiAvatar.watch');
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const look = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/supervision`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSurvey((await res.json()) as Survey);
    } catch (err) {
      logger.warn({ err }, 'could not survey the backlog');
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Asked once when the tab opens: this is what the tab is for, and a button
  // to press first would be a step with no decision in it.
  useEffect(() => {
    void look();
  }, [look]);

  const needing = survey?.categories.filter((c) => c.total > 0) ?? [];

  return (
    <section className="space-y-2 p-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('title')}</h3>
        <button
          type="button"
          onClick={() => void look()}
          disabled={loading}
          className="rounded px-2 py-0.5 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {loading ? t('looking') : t('again')}
        </button>
      </div>

      {failed && <p className="text-[11px] text-red-600 dark:text-red-400">{t('failed')}</p>}

      {survey && !failed && (
        <>
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
            {survey.total === 0 ? t('allClear') : t('needHand', { count: survey.total })}
          </p>

          {needing.map((finding) => (
            <div
              key={finding.category}
              className="space-y-1 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700"
            >
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                  {t(`category.${finding.category}`)}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {finding.total}
                </span>
              </p>
              {/* Why it is here, not just that it is — a list of titles with
                  no reason attached is a list the reader has to re-derive. */}
              <p className="text-[10px] text-zinc-400">{t(`why.${finding.category}`)}</p>

              <ul className="space-y-0.5">
                {finding.tasks.map((task) => (
                  <li key={task.id} className="flex items-baseline gap-2">
                    <a
                      href={taskHref(task.id)}
                      className="min-w-0 flex-1 truncate text-[11px] text-zinc-700 hover:underline dark:text-zinc-200"
                    >
                      {task.title}
                    </a>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
                      {t('waitingDays', { days: daysSince(task.updatedAt) })}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Ten is all a category carries; saying so stops the count and
                  the list looking like a contradiction. */}
              {finding.total > finding.tasks.length && (
                <p className="text-[10px] text-zinc-400">
                  {t('showing', { shown: finding.tasks.length })}
                </p>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

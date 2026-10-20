'use client';
/**
 * TaskAsk
 *
 * Asking ラピ about the backlog.
 *
 * The count and the rows come from the database; the model's only job was to
 * turn the question into a query. That query is shown alongside the answer,
 * because a misread question is invisible otherwise — you would just get a
 * confident number for something you did not ask.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { isImeComposing } from '@/utils/ime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rapi-ask');

interface AnswerRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
}

interface Answer {
  available: boolean;
  query?: Record<string, unknown>;
  total?: number;
  rows?: AnswerRow[];
  unclear?: string[];
}

/** Where a task opens from here. Headered, per the task-link rule. */
const taskHref = (id: number) => `/tasks/${id}?showHeader=true`;

export function TaskAsk() {
  const t = useTranslations('rapiAvatar.ask');
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState(false);

  const ask = async () => {
    if (!text.trim()) return;
    setAsking(true);
    setError(false);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAnswer((await res.json()) as Answer);
    } catch (err) {
      logger.warn({ err }, 'question failed');
      setAnswer(null);
      setError(true);
    } finally {
      setAsking(false);
    }
  };

  /** The conditions, as a short human line. */
  const conditions = (q: Record<string, unknown>): string => {
    const parts: string[] = [];
    if (q.statuses && Array.isArray(q.statuses) && q.statuses.length)
      parts.push(String(q.statuses.join(' / ')));
    if (typeof q.titleContains === 'string') parts.push(`「${q.titleContains}」`);
    if (typeof q.updatedWithinDays === 'number')
      parts.push(t('withinDays', { days: q.updatedWithinDays }));
    if (typeof q.updatedBeforeDays === 'number')
      parts.push(t('beforeDays', { days: q.updatedBeforeDays }));
    return parts.join(' · ');
  };

  return (
    <section className="space-y-2 p-2">
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('title')}</h3>

      <textarea
        rows={2}
        value={text}
        placeholder={t('placeholder')}
        aria-label={t('title')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e.nativeEvent)) {
            e.preventDefault();
            void ask();
          }
        }}
        className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <button
        type="button"
        onClick={() => void ask()}
        disabled={!text.trim() || asking}
        className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {asking ? t('asking') : t('ask')}
      </button>

      {answer && !answer.available && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{t('unavailable')}</p>
      )}

      {answer?.available && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
            {t('found', { total: answer.total ?? 0 })}
          </p>
          {answer.query && conditions(answer.query) && (
            <p className="text-[10px] text-zinc-400">
              {t('readAs', { as: conditions(answer.query) })}
            </p>
          )}

          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {(answer.rows ?? []).map((r) => (
              <li key={r.id}>
                <a
                  href={taskHref(r.id)}
                  className="block truncate text-[11px] text-zinc-700 hover:underline dark:text-zinc-200"
                >
                  {r.title}
                </a>
                <span className="text-[10px] text-zinc-400">{r.status}</span>
              </li>
            ))}
          </ul>

          {(answer.total ?? 0) > (answer.rows?.length ?? 0) && (
            <p className="text-[10px] text-zinc-400">
              {t('showing', { shown: answer.rows?.length ?? 0 })}
            </p>
          )}

          {(answer.unclear ?? []).length > 0 && (
            <ul className="list-inside list-disc">
              {(answer.unclear ?? []).map((u) => (
                <li key={u} className="text-[10px] text-amber-700 dark:text-amber-400">
                  {u}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{t('error')}</p>}
    </section>
  );
}

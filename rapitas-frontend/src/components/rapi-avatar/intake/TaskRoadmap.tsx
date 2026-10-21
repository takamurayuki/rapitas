'use client';
/**
 * TaskRoadmap
 *
 * Talking something over with ラピ until it is a set of tasks.
 *
 * One round, not a conversation. She has no memory between messages, so she
 * asks everything she needs at once — the questions carry two to four
 * choices and a recommendation, the same rule the workflow's own
 * `question.md` follows, because a choice offered without one hands the
 * decision back without helping make it.
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useNoteStore } from '@/stores/note-store';

const logger = createLogger('rapi-roadmap');

interface Placement {
  kind: 'existing' | 'new' | 'none';
  id?: number;
  name?: string;
  reason?: string;
}

interface Question {
  question: string;
  options: string[];
  recommended?: string;
  recommendedReason?: string;
}

interface Step {
  title: string;
  description: string;
}

interface Draft {
  goal: string;
  themeChoice: Placement;
  projectChoice: Placement;
  questions: Question[];
  steps: Step[];
}

interface Committed {
  themeId: number | null;
  projectId: number | null;
  taskIds: number[];
  failedAfter: number | null;
}

export interface TaskRoadmapProps {
  /** What the user asked for, handed over by the single input. */
  handedOver?: string;
}

/** Where a task opens from the note. Headered, per the task-link rule. */
const taskHref = (id: number) => `/tasks/${id}?showHeader=true`;

export function TaskRoadmap({ handedOver }: TaskRoadmapProps = {}) {
  const t = useTranslations('rapiAvatar.roadmap');
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const currentNoteId = useNoteStore((s) => s.currentNoteId);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [drafting, setDrafting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const ask = useCallback(async (text: string) => {
    setDrafting(true);
    setFailed(false);
    setUnavailable(false);
    setCommitted(null);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/roadmap/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { available?: boolean; draft?: Draft };
      if (!data.available || !data.draft) {
        setUnavailable(true);
        return;
      }
      setDraft(data.draft);
      // Start each question on its recommendation: she has said which she
      // would pick and why, and leaving them blank makes the reader redo
      // that reasoning before they can disagree with it.
      setAnswers(
        Object.fromEntries(
          data.draft.questions.map((q, i) => [i, q.recommended ?? q.options[0] ?? '']),
        ),
      );
    } catch (err) {
      logger.warn({ err }, 'could not draft a roadmap');
      setFailed(true);
    } finally {
      setDrafting(false);
    }
  }, []);

  // Asked once per handover — the user already pressed Enter on it.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!handedOver || askedFor.current === handedOver) return;
    askedFor.current = handedOver;
    void ask(handedOver);
  }, [handedOver, ask]);

  /** The note: what was decided and why, beside links to what was made. */
  const writeNote = (plan: Draft, made: Committed) => {
    const lines = [
      `# ${plan.goal}`,
      '',
      '## 決めたこと',
      ...plan.questions.map((q, i) => `- ${q.question} → ${answers[i] ?? '—'}`),
      '',
      '## 置き場所',
      `- テーマ: ${plan.themeChoice.name ?? '—'}${plan.themeChoice.kind === 'new' ? '（新規）' : ''}`,
      `- プロジェクト: ${plan.projectChoice.kind === 'none' ? 'なし' : (plan.projectChoice.name ?? '—')}`,
      '',
      '## 作ったタスク',
      ...made.taskIds.map((id, i) => `- [${plan.steps[i]?.title ?? id}](${taskHref(id)})`),
    ];
    createNote(plan.goal);
    // `createNote` makes it current, so the id to fill in is the current one.
    const id = useNoteStore.getState().currentNoteId ?? currentNoteId;
    if (id) updateNote(id, { content: lines.join('\n') });
  };

  const commit = async () => {
    if (!draft || committing) return;
    setCommitting(true);
    setFailed(false);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/roadmap/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          goal: draft.goal,
          themeChoice: draft.themeChoice,
          projectChoice: draft.projectChoice,
          steps: draft.steps,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const made = (await res.json()) as Committed;
      setCommitted(made);
      writeNote(draft, made);
    } catch (err) {
      logger.warn({ err }, 'could not create the roadmap');
      setFailed(true);
    } finally {
      setCommitting(false);
    }
  };

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

          {draft.questions.map((q, i) => (
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

          <ul className="max-h-52 space-y-1 overflow-y-auto">
            {draft.steps.map((s) => (
              <li
                key={s.title}
                className="rounded border border-zinc-200 p-1.5 dark:border-zinc-700"
              >
                <span className="block text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                  {s.title}
                </span>
                <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                  {s.description}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => void commit()}
            disabled={committing}
            className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {committing ? t('creating') : t('create', { count: draft.steps.length })}
          </button>
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

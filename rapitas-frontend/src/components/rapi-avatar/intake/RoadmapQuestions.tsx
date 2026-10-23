'use client';
/**
 * RoadmapQuestions
 *
 * The interview, asked one question at a time.
 *
 * Every question used to be drawn at once. In the 320px panel that is a
 * wall — four questions with their options and their reasons push the plan
 * they are about off the screen, and nothing says how far through you are.
 * Asked for 2026-10-22: answer one, move to the next.
 *
 * What has been decided stays, as one line each. Compact must not mean
 * final: the answers drive the plan that is drafted from them, and noticing
 * the wrong one two questions later is the normal case, so each line reopens.
 *
 * "Decided" means the user chose, not that an answer exists. Every question
 * arrives with its recommendation already selected, so a first-unanswered
 * rule would find none and open nothing. The recommendation still stands if
 * the plan is refined without stepping through — it is pre-selected on each
 * question and sent either way; stepping through is what collapses them.
 *
 * Owns only the asking. The answers belong to the roadmap conversation
 * (use-roadmap.ts), which sends them back out on the next draft.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** One question as the draft returned it. */
export interface RoadmapQuestion {
  question: string;
  options: string[];
  recommended?: string;
  recommendedReason?: string;
}

interface Props {
  questions: RoadmapQuestion[];
  /** Answers by question index, as the roadmap holds them. */
  answers: Record<number, string>;
  setAnswers: (update: (prev: Record<number, string>) => Record<number, string>) => void;
}

/**
 * @param props - The questions, the answers so far, and how to record one
 */
export function RoadmapQuestions({ questions, answers, setAnswers }: Props) {
  const t = useTranslations('rapiAvatar.roadmap');
  /** A decision reopened for changing; otherwise the flow picks the question. */
  const [editing, setEditing] = useState<number | null>(null);
  /** Questions the user has actually chosen on, in this session. */
  const [decided, setDecided] = useState<ReadonlySet<number>>(() => new Set());

  if (questions.length === 0) return null;

  const firstUndecided = questions.findIndex((_, i) => !decided.has(i));
  // Reopening wins over the flow: the user asked for that one specifically.
  const open = editing !== null && editing < questions.length ? editing : firstUndecided;

  const choose = (index: number, option: string) => {
    setAnswers((prev) => ({ ...prev, [index]: option }));
    setDecided((prev) => new Set(prev).add(index));
    // Clearing this is what advances: with nothing reopened the flow moves to
    // the next undecided question on its own.
    setEditing(null);
  };

  return (
    <div className="space-y-1.5">
      {questions.map((q, i) => {
        const answer = answers[i];
        if (i !== open) {
          // Not yet reached: its recommendation still counts, it just has no
          // line of its own until the user has been shown it.
          if (!decided.has(i) || answer === undefined) return null;
          return (
            <button
              key={q.question}
              type="button"
              data-roadmap-answered={q.question}
              onClick={() => setEditing(i)}
              className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-[10px] text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <span className="truncate">{q.question}</span>
              <span className="ml-auto shrink-0 font-medium text-zinc-700 dark:text-zinc-200">
                {answer}
              </span>
            </button>
          );
        }

        return (
          <div key={q.question} data-roadmap-question={q.question} className="space-y-1">
            <div className="flex items-baseline gap-2">
              <p className="text-[11px] text-zinc-700 dark:text-zinc-200">{q.question}</p>
              {/* How far through, so a wall of questions is not replaced by a
                  sequence with no end in sight. */}
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-400">
                {t('progress', { current: decided.size + 1, total: questions.length })}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => choose(i, o)}
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
            {/* Why she would pick that one. Without it the recommendation is
                an assertion rather than an argument. */}
            {q.recommendedReason && (
              <p className="text-[10px] text-zinc-400">{q.recommendedReason}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

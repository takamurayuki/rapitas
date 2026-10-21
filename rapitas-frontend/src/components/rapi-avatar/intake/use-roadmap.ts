/**
 * useRoadmap
 *
 * The two rounds of talking something over, as state.
 *
 * Round one asks; round two is handed the answers and plans against them.
 * It was one round until the answers were found to change nothing — the plan
 * was drafted before they were given, so whichever option was picked the
 * same tasks were created and the choice reached only the note. `refine` is
 * that second call, and `unanswered` is what stops the sketch being created
 * in the meantime.
 *
 * The questions are kept apart from the plan on purpose: the final round
 * returns none, so without `asked` the decisions would disappear from the
 * screen and from the note the moment she plans against them.
 *
 * Not responsible for drawing any of it — see `TaskRoadmap.tsx`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useNoteStore } from '@/stores/note-store';
import { composeRoadmapNote } from './roadmap-note';

const logger = createLogger('rapi-roadmap');

export interface Placement {
  kind: 'existing' | 'new' | 'none';
  id?: number;
  name?: string;
  reason?: string;
}

export interface Question {
  question: string;
  options: string[];
  recommended?: string;
  recommendedReason?: string;
}

export interface Step {
  title: string;
  description: string;
  dueDate?: string;
}

export interface Draft {
  goal: string;
  themeChoice: Placement;
  projectChoice: Placement;
  questions: Question[];
  steps: Step[];
  deadline?: string;
}

/** One question and what the user picked, as the draft call wants it. */
interface Decision {
  question: string;
  answer: string;
}

export interface Committed {
  themeId: number | null;
  projectId: number | null;
  taskIds: number[];
  failedAfter: number | null;
}

/**
 * Run the roadmap conversation for one thing the user asked for.
 *
 * @param handedOver - What they said, passed on by the single input / 入力欄から渡された依頼
 * @returns The plan, the answers, and the three things that can be done / 計画・回答・操作
 */
export function useRoadmap(handedOver?: string) {
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const currentNoteId = useNoteStore((s) => s.currentNoteId);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [asked, setAsked] = useState<Question[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const ask = useCallback(async (text: string, decisions?: Decision[]) => {
    setDrafting(true);
    setFailed(false);
    setUnavailable(false);
    setCommitted(null);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/roadmap/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(decisions?.length ? { answers: decisions } : {}) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { available?: boolean; draft?: Draft };
      if (!data.available || !data.draft) {
        setUnavailable(true);
        return;
      }
      setDraft(data.draft);
      // Only the round that asks sets these; the final round returns no
      // questions and must not wipe what was answered.
      if (data.draft.questions.length > 0) {
        setAsked(data.draft.questions);
        // Start each question on its recommendation: she has said which she
        // would pick and why, and leaving them blank makes the reader redo
        // that reasoning before they can disagree with it.
        setAnswers(
          Object.fromEntries(
            data.draft.questions.map((q, i) => [i, q.recommended ?? q.options[0] ?? '']),
          ),
        );
      }
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

  /** The decisions, in the order they were asked. */
  const decisions = (): Decision[] =>
    asked.map((q, i) => ({ question: q.question, answer: answers[i] ?? '—' }));

  /** Ask her to plan again, this time knowing what was chosen. */
  const refine = () => {
    if (!handedOver || drafting) return;
    void ask(handedOver, decisions());
  };

  /** The note: what was decided and why, beside links to what was made. */
  const writeNote = (plan: Draft, made: Committed) => {
    const body = composeRoadmapNote({
      goal: plan.goal,
      decisions: decisions(),
      theme: `${plan.themeChoice.name ?? '—'}${plan.themeChoice.kind === 'new' ? '（新規）' : ''}`,
      project: plan.projectChoice.kind === 'none' ? 'なし' : (plan.projectChoice.name ?? '—'),
      ...(plan.deadline ? { deadline: plan.deadline } : {}),
      steps: plan.steps,
      taskIds: made.taskIds,
    });
    createNote(plan.goal);
    // `createNote` makes it current, so the id to fill in is the current one.
    const id = useNoteStore.getState().currentNoteId ?? currentNoteId;
    if (id) updateNote(id, { content: body });
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

  return {
    draft,
    asked,
    answers,
    setAnswers,
    drafting,
    committing,
    committed,
    failed,
    unavailable,
    /**
     * Whether the plan on screen is still the sketch: true exactly while a
     * round that asked questions has not been planned against yet.
     */
    unanswered: (draft?.questions.length ?? 0) > 0,
    refine,
    commit,
  };
}

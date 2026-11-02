/**
 * useProfileInterview
 *
 * The rounds of ラピ asking who you are, as state.
 *
 * Every round is handed back every answer so far. That is not an
 * optimisation — ラピ has no memory between messages, so a round that is not
 * given the previous answers cannot go deeper, it can only ask the opening
 * questions again. The roadmap interview shipped exactly that defect once:
 * the questions were asked and the plan was already drafted, so whatever was
 * picked, the same tasks came out.
 *
 * Each question arrives with ラピ's recommendation already selected, so a
 * user who agrees with all of them presses straight on and the round still
 * carries answers. Nothing here is empty by default, and nothing here is
 * stored: the draft goes back to the card, which only writes it when the
 * user applies it.
 *
 * Not responsible for drawing any of it — see `RapiProfileInterview.tsx`.
 */
import { useCallback, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

/** One question as ラピ asked it. */
export interface ProfileQuestion {
  question: string;
  options: string[];
  recommended?: string;
  recommendedReason?: string;
}

/** One question and what the user picked. */
export interface ProfileAnswer {
  question: string;
  answer: string;
}

/** The two halves she wrote, each present only when she wrote it. */
export interface ProfileDraft {
  profile?: string;
  character?: string;
}

/** What the interview is waiting on, if anything. */
type Busy = 'asking' | 'composing' | null;

/** Why there is nothing to show, when there is nothing to show. */
type Trouble = 'unavailable' | 'failed' | null;

interface RoundReply {
  available?: boolean;
  questions?: ProfileQuestion[];
  maxRounds?: number;
}

interface ComposeReply {
  available?: boolean;
  draft?: ProfileDraft;
}

/**
 * Run the interview for one person.
 *
 * @param known - What the boxes currently say, unsaved edits included / 画面上の自己紹介
 * @returns The round on screen, the draft, and what can be done / 質問・下書き・操作
 */
export function useProfileInterview(known: { profile: string; character: string }) {
  const [asked, setAsked] = useState<ProfileQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  /** Answers from the rounds already finished. */
  const [collected, setCollected] = useState<ProfileAnswer[]>([]);
  const [rounds, setRounds] = useState(0);
  const [maxRounds, setMaxRounds] = useState(0);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [trouble, setTrouble] = useState<Trouble>(null);

  const post = useCallback(
    async <T>(path: string, answered: ProfileAnswer[]): Promise<T | null> => {
      const res = await fetch(`${API_BASE_URL}/assistant/profile/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Both halves every time, empty or not: an absent key tells the
        // server to read the stored row, which is not the same thing as a
        // box the user has just cleared.
        body: JSON.stringify({
          profile: known.profile,
          character: known.character,
          ...(answered.length > 0 ? { answers: answered } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    [known.profile, known.character],
  );

  /**
   * The round on screen, as answers.
   *
   * Falls back to the recommendation and then to the first option, so a
   * question can never contribute nothing — a missing answer would read to
   * the next round as "they declined to say", which is not what an untouched
   * recommendation means.
   */
  const harvest = useCallback(
    (): ProfileAnswer[] =>
      asked.map((q, i) => ({
        question: q.question,
        answer: answers[i] ?? q.recommended ?? q.options[0] ?? '',
      })),
    [asked, answers],
  );

  const ask = useCallback(
    async (answered: ProfileAnswer[]) => {
      setBusy('asking');
      setTrouble(null);
      try {
        const reply = await post<RoundReply>('questions', answered);
        if (!reply?.available || !reply.questions) {
          setTrouble('unavailable');
          return;
        }
        setCollected(answered);
        setAsked(reply.questions);
        // Start each question on her recommendation: she has said which she
        // would pick and why, and leaving them blank makes the reader redo
        // that reasoning before they can disagree with it.
        setAnswers(
          Object.fromEntries(
            reply.questions.map((q, i) => [i, q.recommended ?? q.options[0] ?? '']),
          ),
        );
        setMaxRounds(reply.maxRounds ?? 0);
        setRounds((n) => n + 1);
        setDraft(null);
      } catch {
        setTrouble('failed');
      } finally {
        setBusy(null);
      }
    },
    [post],
  );

  const start = useCallback(() => {
    setCollected([]);
    setRounds(0);
    setAsked([]);
    setAnswers({});
    setDraft(null);
    void ask([]);
  }, [ask]);

  const deeper = useCallback(
    () => void ask([...collected, ...harvest()]),
    [ask, collected, harvest],
  );

  const compose = useCallback(async () => {
    setBusy('composing');
    setTrouble(null);
    try {
      const reply = await post<ComposeReply>('compose', [...collected, ...harvest()]);
      if (!reply?.available || !reply.draft) {
        setTrouble('unavailable');
        return;
      }
      setDraft(reply.draft);
    } catch {
      setTrouble('failed');
    } finally {
      setBusy(null);
    }
  }, [post, collected, harvest]);

  const reset = useCallback(() => {
    setAsked([]);
    setAnswers({});
    setCollected([]);
    setRounds(0);
    setDraft(null);
    setTrouble(null);
  }, []);

  return {
    asked,
    answers,
    setAnswers,
    draft,
    busy,
    trouble,
    /** Rounds asked so far, and how many more there may be. */
    rounds,
    canGoDeeper: asked.length > 0 && rounds < maxRounds,
    start,
    deeper,
    compose,
    reset,
  };
}

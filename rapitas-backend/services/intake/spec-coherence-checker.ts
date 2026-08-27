/**
 * Spec Coherence Checker
 *
 * Judges whether a task's acceptance criteria are ABOUT that task. The existing
 * spec-quality-checker asks whether a spec is substantial enough; this asks
 * whether it is the right spec. They are different failures, and today's
 * expensive ones were the second kind — every criterion involved was
 * substantial, well-formed, and about something else.
 *
 * Pure and side-effect-free: callers fetch the referenced tasks and pass them
 * in. No DB, no AI.
 *
 * Measured 2026-08-27 — of the five tasks needing three or more repair rounds,
 * three had defective criteria rather than defective implementations, and each
 * was rescued only by a human rewriting the criteria.
 */

/** A task whose text this spec cites — supplied by the caller. */
export interface ReferencedTask {
  id: number;
  title: string;
}

/** One criterion that appears to belong to another task. */
export interface ContaminatedCriterion {
  /** 1-based index, matching how repair reasons cite criteria. */
  index: number;
  criterion: string;
  /** The task whose subject matter it carries. */
  sourceTaskId: number;
  /** The coined phrases it lifted from that task's title. */
  phrases: string[];
}

/**
 * Shortest quoted phrase treated as distinctive.
 *
 * A title quotes the terms it is introducing — 「素直な修正不要」,
 * 「往復した末の修正不要」. Those are coined vocabulary, not shared language, so
 * finding one inside another task's criteria means the criteria were written
 * about the wrong task. Short quotes say nothing and are excluded.
 */
export const MIN_PHRASE_LENGTH = 5;

/** Task ids cited anywhere in a text, e.g. `#662`. */
export function extractReferencedTaskIds(text: string | null | undefined): number[] {
  if (!text) return [];
  const ids = new Set<number>();
  for (const m of text.matchAll(/#(\d{2,5})/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n)) ids.add(n);
  }
  return [...ids];
}

/**
 * Quoted terms a title is coining, as opposed to prose it happens to contain.
 *
 * Whole-string similarity does NOT find contamination: task 671's criteria
 * scored 0.06–0.22 bigram-Jaccard against the title they came from, because
 * each criterion decomposes that title rather than repeating it. The coined
 * phrases inside them matched exactly.
 *
 * @param title - A task title. / タスクのタイトル
 * @returns Distinctive quoted phrases. / 引用された固有の用語
 */
export function extractCoinedPhrases(title: string): string[] {
  const out = new Set<string>();
  for (const m of title.matchAll(/[「『”"']([^」』”"']+)[」』”"']/g)) {
    const phrase = m[1].trim();
    if (phrase.length >= MIN_PHRASE_LENGTH) out.add(phrase);
  }
  return [...out];
}

/**
 * Find acceptance criteria that are really another task's subject matter.
 *
 * Detection is by coined phrase rather than similarity: lifted criteria get
 * rewritten into criterion form, so they stop resembling the source title as
 * strings — but the vocabulary that title introduced survives intact.
 *
 * @param criteria - This task's acceptance criteria. / 受入基準
 * @param referenced - Tasks this spec cites, excluding itself. / 参照タスク
 * @returns One entry per criterion carrying another task's vocabulary. / 混入と判断した基準
 */
export function findContaminatedCriteria(
  criteria: string[],
  referenced: ReferencedTask[],
): ContaminatedCriterion[] {
  const byTask = referenced.map((t) => ({ id: t.id, phrases: extractCoinedPhrases(t.title) }));
  const out: ContaminatedCriterion[] = [];
  for (const [i, criterion] of criteria.entries()) {
    for (const ref of byTask) {
      const phrases = ref.phrases.filter((p) => criterion.includes(p));
      if (phrases.length === 0) continue;
      out.push({ index: i + 1, criterion, sourceTaskId: ref.id, phrases });
      break;
    }
  }
  return out;
}

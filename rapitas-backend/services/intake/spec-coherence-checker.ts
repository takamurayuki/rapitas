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

/** How a criterion was found to be about something else. */
export type ContaminationKind = 'coined_phrase' | 'quoted_title';

/** One criterion that appears to belong to another task. */
export interface ContaminatedCriterion {
  /** 1-based index, matching how repair reasons cite criteria. */
  index: number;
  criterion: string;
  /** The task whose subject matter it carries. */
  sourceTaskId: number;
  /** The distinctive tokens it lifted from that task. */
  phrases: string[];
  /** Which evidence path flagged it. / どちらの根拠で検出したか */
  kind: ContaminationKind;
}

/**
 * A task id followed by that task's title in quotes, e.g. `#666「…」`.
 *
 * The self-incident watcher builds titles this way, so the quoted span is by
 * construction ANOTHER task's subject sitting inside this one's title.
 */
const QUOTED_TASK_RE = /#(\d{2,5})\s*[「『]([^」』]+)[」』]/g;

/** Path-like tokens such as `risk-detection.ts` — unambiguous deliverable names. */
const FILE_TOKEN_RE = /[A-Za-z0-9_-][A-Za-z0-9_./-]*[.][a-z0-9]{1,6}/g;

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
 * Titles of other tasks quoted inside this task's own text.
 *
 * @param text - This task's title and description. / タイトルと説明
 * @returns Each cited task id with the title quoted for it. / 引用元IDと引用文
 */
export function extractQuotedTaskTitles(text: string | null | undefined): ReferencedTask[] {
  if (!text) return [];
  return [...text.matchAll(QUOTED_TASK_RE)].map((m) => ({
    id: Number(m[1]),
    title: m[2].trim(),
  }));
}

/**
 * The task's own words, with every quoted foreign title removed.
 *
 * Needed because the quote usually appears twice — once in the title and once
 * in a `## 対象タスク` section — so a token cannot be cleared as "the task
 * mentions it itself" just by appearing elsewhere in the text.
 *
 * @param text - This task's title and description. / タイトルと説明
 * @returns The same text minus the quoted spans. / 引用を除いた本文
 */
export function stripQuotedTaskTitles(text: string | null | undefined): string {
  return (text ?? '').replace(QUOTED_TASK_RE, ' ');
}

/** Distinctive file tokens in a text, lowercased and reduced to basenames. */
function fileTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(FILE_TOKEN_RE)) {
    const base = m[0].split(/[\\/]/).pop();
    if (base) out.add(base.toLowerCase());
  }
  return out;
}

/**
 * Criteria written about a task this one merely cites.
 *
 * Measured on task 669: its title embedded task 666's title verbatim, and two
 * of its five criteria came back describing 666's refactor rather than the
 * repeat-loop 669 was filed to stop. The verifier correctly reported those two
 * as absent from the diff, which cost ten repair rounds and a human rewrite.
 *
 * @param criteria - This task's acceptance criteria. / 受入基準
 * @param ownText - This task's title and description. / タイトルと説明
 * @returns One entry per criterion drawn from a quoted title. / 引用由来の基準
 */
export function findLiftedFromQuotedTitle(
  criteria: string[],
  ownText: string | null | undefined,
): ContaminatedCriterion[] {
  const quoted = extractQuotedTaskTitles(ownText);
  if (quoted.length === 0) return [];
  const ownTokens = fileTokens(stripQuotedTaskTitles(ownText));
  const sources = quoted
    .map((q) => ({
      id: q.id,
      // A file the task names outside the quote is legitimately in its scope.
      tokens: [...fileTokens(q.title)].filter((t) => !ownTokens.has(t)),
    }))
    .filter((s) => s.tokens.length > 0);

  const out: ContaminatedCriterion[] = [];
  for (const [i, criterion] of criteria.entries()) {
    const found = fileTokens(criterion);
    for (const src of sources) {
      const hit = src.tokens.filter((t) => found.has(t));
      if (hit.length === 0) continue;
      out.push({
        index: i + 1,
        criterion,
        sourceTaskId: src.id,
        phrases: hit,
        kind: 'quoted_title',
      });
      break;
    }
  }
  return out;
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
 * @param ownText - This task's title and description, for the quoted-title
 *   path. Omit to run the coined-phrase check alone. / タイトルと説明
 * @returns One entry per criterion carrying another task's vocabulary. / 混入と判断した基準
 */
export function findContaminatedCriteria(
  criteria: string[],
  referenced: ReferencedTask[],
  ownText?: string | null,
): ContaminatedCriterion[] {
  const byTask = referenced.map((t) => ({ id: t.id, phrases: extractCoinedPhrases(t.title) }));
  const out: ContaminatedCriterion[] = [];
  for (const [i, criterion] of criteria.entries()) {
    for (const ref of byTask) {
      const phrases = ref.phrases.filter((p) => criterion.includes(p));
      if (phrases.length === 0) continue;
      out.push({ index: i + 1, criterion, sourceTaskId: ref.id, phrases, kind: 'coined_phrase' });
      break;
    }
  }
  const flagged = new Set(out.map((h) => h.index));
  for (const hit of findLiftedFromQuotedTitle(criteria, ownText)) {
    if (!flagged.has(hit.index)) out.push(hit);
  }
  return out.sort((a, b) => a.index - b.index);
}

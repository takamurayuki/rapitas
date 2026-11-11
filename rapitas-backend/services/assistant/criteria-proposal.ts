/**
 * CriteriaProposal
 *
 * Makes sure every task ラピ files arrives with a definition of done the user
 * has seen (companion design ch.3 段B, ch.7 stage 1 item 1). The jury, the
 * self-check and the landing classifier all read `Task.acceptanceCriteria`; a
 * task filed with that column empty is classified `criteria_missing` and
 * judged against "the plan's intent" instead of anything the user agreed to.
 *
 * What a proposal carries (段B):
 * - 3〜7 checkable sentences. What the reader proposed comes first; when it
 *   proposed fewer than three, checkable sentences built from the task's own
 *   title / goals / constraints fill the gap (flagged, so the card can say
 *   they are only a starting point).
 * - Per criterion, who checks it — the jury from the diff, or the person
 *   themselves — and, for a vague one, a concrete rewording to consider.
 * - A score from the existing `spec-quality-checker`, plus the vague-term
 *   findings, so the card can show how solid the definition of done is.
 *
 * The verifier mark decides where a confirmed criterion is stored (design 4.1
 * 案1, Q2 approved 2026-11-12): {@link splitByVerifier} sends the jury's to
 * `Task.acceptanceCriteria` — the only column the jury, self-check, landing
 * classifier and replanning read — and the person's to
 * `Task.userAcceptanceChecks`. The server's split is the one that counts; the
 * card's tags come from {@link reviewCriteria}, the same rules.
 *
 * The `## 完了条件` checklist of a roadmap step description is read in
 * `criteria-text.ts` (re-exported here, with `normalizeCriteria`).
 *
 * Pure — no database, no model. Not responsible for refusing a write; the
 * routes do that.
 */
import { checkSpecQuality } from '../intake/spec-quality-checker';
import { normalizeCriteria, MAX_CRITERION_LENGTH } from './criteria-text';
import { classifyVerifier, findVagueTerm, type CriterionVerifier } from './criteria-wording';
import {
  detectTaskKind,
  supplementCandidates,
  type SupplementCandidate,
  type TaskKind,
} from './criteria-supplement';

export { classifyVerifier, findVagueTerm, type CriterionVerifier } from './criteria-wording';
export { detectTaskKind, type TaskKind } from './criteria-supplement';
export {
  normalizeCriteria,
  criteriaFromDescription,
  withoutCriteriaSection,
  MAX_CRITERIA,
  MAX_CRITERION_LENGTH,
  ACCEPTANCE_CRITERIA_REQUIRED,
} from './criteria-text';

/** How many criteria a proposal aims for (design 段B: 3〜7). */
export const MIN_PROPOSED_CRITERIA = 3;
export const MAX_PROPOSED_CRITERIA = 7;

/** One proposed criterion, as the confirmation card shows it. */
export interface ProposedCriterion {
  text: string;
  verifier: CriterionVerifier;
  /** Set when the text leans on a word nobody can check; the hint says how to firm it up. */
  vague?: { term: string; suggestion: string };
  /** True when ラピ added it to reach the minimum, rather than the reader proposing it. */
  supplemented?: boolean;
  /**
   * True for a sentence ラピ wrote without enough material to be specific. It
   * is always the person's to check, and the card asks for it to be reworded.
   */
  generic?: boolean;
}

/** How solid the proposed definition of done is. */
export interface CriteriaQuality {
  /** spec-quality-checker's 0..100 score for the spec with these criteria. */
  score: number;
  /** spec-quality-checker's verdict (score ≥ ADEQUATE_SCORE). */
  isAdequate: boolean;
  /** How many criteria carry a vague term. */
  vagueCount: number;
  /** Plain reasons: the checker's, then one per vague criterion. */
  reasons: string[];
}

/** A full proposal: the texts the column will hold, and what the card shows about them. */
export interface CriteriaProposal {
  criteria: string[];
  items: ProposedCriterion[];
  /** True when the reader proposed nothing at all. */
  fallback: boolean;
  /** How many items ラピ added to reach {@link MIN_PROPOSED_CRITERIA}. */
  supplemented: number;
  /** What sort of task the wording reads as; picks the supplement sentences. */
  kind: TaskKind;
  quality: CriteriaQuality;
}

/** What a proposal is built from. Everything but the title is optional. */
export interface CriteriaProposalInput {
  title: string;
  /** What the reader (intent-reader / roadmap step) proposed. */
  proposed?: unknown;
  description?: string | null;
  goals?: unknown;
  constraints?: unknown;
}

/** A JSON-array string, an array, or nothing — the shapes the spec columns use. */
function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The task fields the verifier and the supplements are read from. */
function context(input: CriteriaProposalInput) {
  const goals = normalizeCriteria(parseList(input.goals));
  const constraints = normalizeCriteria(parseList(input.constraints));
  const base = { title: input.title, description: input.description, goals, constraints };
  const kind = detectTaskKind(base);
  const candidates = new Map<string, SupplementCandidate>(
    supplementCandidates(base, kind).map((c) => [c.text.slice(0, MAX_CRITERION_LENGTH), c]),
  );
  return { kind, candidates };
}

type Context = ReturnType<typeof context>;

/** One criterion with its verifier mark and, if vague, the hint. */
function describe(text: string, ctx: Context, supplemented: boolean): ProposedCriterion {
  // A sentence ラピ wrote keeps the verifier it was written for; anything
  // else (the reader's, the user's own rewording) is classified by its words.
  const own = ctx.candidates.get(text);
  const vague = findVagueTerm(text);
  return {
    text,
    verifier: own?.verifier ?? classifyVerifier(text, ctx.kind),
    ...(vague ? { vague } : {}),
    ...(supplemented ? { supplemented: true } : {}),
    ...(own?.generic ? { generic: true } : {}),
  };
}

/** The checker's score and the vague / generic findings for a set of items. */
function qualityOf(input: CriteriaProposalInput, items: ProposedCriterion[]): CriteriaQuality {
  const spec = checkSpecQuality({
    description: input.description ?? null,
    goals: input.goals ?? null,
    constraints: input.constraints ?? null,
    acceptanceCriteria: items.map((i) => i.text),
  });
  const vague = items.filter((i) => i.vague);
  const generic = items.filter((i) => i.generic);
  return {
    score: spec.score,
    isAdequate: spec.isAdequate,
    vagueCount: vague.length,
    reasons: [
      ...spec.reasons,
      ...vague.map((i) => `「${i.text}」の「${i.vague!.term}」は確かめにくい言葉です。`),
      ...(generic.length > 0
        ? [
            `タスクの内容から具体的な条件を作れなかったため、${generic.length}件は仮の文です。何ができたら終わりかが分かる文に直してください。`,
          ]
        : []),
    ],
  };
}

/**
 * Build the proposal the confirmation card shows (design 段B).
 *
 * @param input - Title, what the reader proposed, and the rest of the spec / 提案の材料
 * @returns 3〜7 criteria with verifier marks, vague hints and a score / 提案
 */
export function proposeCriteria(input: CriteriaProposalInput): CriteriaProposal {
  const proposed = normalizeCriteria(input.proposed).slice(0, MAX_PROPOSED_CRITERIA);
  const ctx = context(input);
  const items: ProposedCriterion[] = proposed.map((text) => describe(text, ctx, false));

  const taken = new Set(proposed);
  for (const text of ctx.candidates.keys()) {
    if (items.length >= MIN_PROPOSED_CRITERIA) break;
    if (taken.has(text)) continue;
    taken.add(text);
    items.push(describe(text, ctx, true));
  }

  return {
    criteria: items.map((i) => i.text),
    items,
    fallback: proposed.length === 0,
    supplemented: items.length - proposed.length,
    kind: ctx.kind,
    quality: qualityOf(input, items),
  };
}

/**
 * Re-read criteria the user has edited, removed or kept, without adding any.
 *
 * What the card calls after an edit, so the tags and the score it shows are
 * the server's — the same rules {@link splitByVerifier} applies on confirm.
 *
 * @param input - The task fields, with `proposed` = the criteria as they now stand / 現在の完了条件と材料
 * @returns The items and the score, plus the task's kind / 判定者・曖昧語・採点
 */
export function reviewCriteria(input: CriteriaProposalInput): {
  items: ProposedCriterion[];
  kind: TaskKind;
  quality: CriteriaQuality;
} {
  const texts = normalizeCriteria(input.proposed);
  const ctx = context(input);
  const items = texts.map((text) => describe(text, ctx, ctx.candidates.has(text)));
  return { items, kind: ctx.kind, quality: qualityOf(input, items) };
}

/**
 * Split confirmed criteria into the jury's and the person's (design 4.1 案1).
 *
 * The server decides, with the same rules the card's tags came from; which
 * array a client put a criterion in is not trusted, so an older client that
 * sends everything as `acceptanceCriteria` is split the same way.
 *
 * @param input - The task fields, with `proposed` = every confirmed criterion / 確定した完了条件と材料
 * @returns `acceptanceCriteria` (jury) and `userAcceptanceChecks` (person), order kept / 2列の値
 */
export function splitByVerifier(input: CriteriaProposalInput): {
  acceptanceCriteria: string[];
  userAcceptanceChecks: string[];
} {
  const { items } = reviewCriteria(input);
  return {
    acceptanceCriteria: items.filter((i) => i.verifier === 'jury').map((i) => i.text),
    userAcceptanceChecks: items.filter((i) => i.verifier === 'user').map((i) => i.text),
  };
}

/**
 * The proposed criteria, or ones built from the task when the proposal had too few.
 *
 * Kept for callers that need only the texts; see {@link proposeCriteria}.
 *
 * @param proposed - Criteria the reader produced / 読み取った完了条件
 * @param title - Task title, for the supplements / タスク名（補う案用）
 * @returns The criteria to put on the card, and whether the reader proposed none / カードに出す完了条件と代案かどうか
 */
export function ensureProposedCriteria(
  proposed: unknown,
  title: string,
): { criteria: string[]; fallback: boolean } {
  const out = proposeCriteria({ title, proposed });
  return { criteria: out.criteria, fallback: out.fallback };
}

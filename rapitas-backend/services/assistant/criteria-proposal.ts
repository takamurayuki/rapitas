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
 * The verifier mark is shown, not stored: every confirmed criterion still goes
 * to `Task.acceptanceCriteria`. Whether "本人が確かめる" items get their own
 * column (`userAcceptanceChecks`, design 4.1 案1 / Q2) is the user's decision
 * and is deliberately not made here.
 *
 * Also reads the `## 完了条件` checklist a roadmap step description carries,
 * for clients that send only the description.
 *
 * Pure — no database, no model. Not responsible for refusing a write; the
 * routes do that.
 */
import { checkSpecQuality } from '../intake/spec-quality-checker';
import { classifyVerifier, findVagueTerm, type CriterionVerifier } from './criteria-wording';

export { classifyVerifier, findVagueTerm, type CriterionVerifier } from './criteria-wording';

/** Matches the route schemas: each criterion ≤ 500 chars, at most 10. */
export const MAX_CRITERIA = 10;
export const MAX_CRITERION_LENGTH = 500;

/** The error a create/commit without criteria is refused with (HTTP 400). */
export const ACCEPTANCE_CRITERIA_REQUIRED = 'acceptance_criteria_required';

/**
 * Trim, drop blanks and duplicates, and bound a criteria list.
 *
 * @param raw - Whatever was proposed or sent / 提案・送信された値
 * @returns The usable criteria, in their original order / 使える完了条件（順序維持）
 */
export function normalizeCriteria(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, MAX_CRITERION_LENGTH);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_CRITERIA) break;
  }
  return out;
}

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

/** Bounded, quoted task name for the sentences ラピ writes herself. */
function taskName(title: string): string {
  return title.trim().slice(0, 120) || 'このタスク';
}

/**
 * Checkable sentences built from the task itself, used to reach the minimum.
 *
 * Goals and constraints first (they are what the user said), then sentences
 * the jury can check from the diff, then one the person checks. Each names
 * the task, so no two tasks share the same definition of done.
 *
 * @param input - The task's own fields / タスク自身の項目
 * @returns Candidate criteria, most specific first / 補う完了条件の候補
 */
function supplementCandidates(input: CriteriaProposalInput): string[] {
  const name = taskName(input.title);
  const goals = normalizeCriteria(parseList(input.goals));
  const constraints = normalizeCriteria(parseList(input.constraints));
  return [
    ...goals.map((g) => `目標「${g}」が達成されたことを、変更内容または成果物で示せる`),
    ...constraints.map((c) => `制約「${c}」を守っている（変更内容で確かめられる）`),
    `「${name}」の成果物（変更・文書など）ができていて、どこにあるかを示せる`,
    `「${name}」に関係しない既存の機能やデータを壊していない（関連するテストや確認手順が通る）`,
    `「${name}」の結果を本人が実際に見て、求めていたものだと確かめられる`,
  ];
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

/**
 * Build the proposal the confirmation card shows (design 段B).
 *
 * @param input - Title, what the reader proposed, and the rest of the spec / 提案の材料
 * @returns 3〜7 criteria with verifier marks, vague hints and a score / 提案
 */
export function proposeCriteria(input: CriteriaProposalInput): CriteriaProposal {
  const proposed = normalizeCriteria(input.proposed).slice(0, MAX_PROPOSED_CRITERIA);
  const items: ProposedCriterion[] = proposed.map((text) => describe(text, false));

  const taken = new Set(proposed);
  for (const text of supplementCandidates(input)) {
    if (items.length >= MIN_PROPOSED_CRITERIA) break;
    const bounded = text.slice(0, MAX_CRITERION_LENGTH);
    if (taken.has(bounded)) continue;
    taken.add(bounded);
    items.push(describe(bounded, true));
  }

  const criteria = items.map((i) => i.text);
  const spec = checkSpecQuality({
    description: input.description ?? null,
    goals: input.goals ?? null,
    constraints: input.constraints ?? null,
    acceptanceCriteria: criteria,
  });
  const vague = items.filter((i) => i.vague);
  const reasons = [
    ...spec.reasons,
    ...vague.map((i) => `「${i.text}」の「${i.vague!.term}」は確かめにくい言葉です。`),
  ];

  return {
    criteria,
    items,
    fallback: proposed.length === 0,
    supplemented: items.length - proposed.length,
    quality: {
      score: spec.score,
      isAdequate: spec.isAdequate,
      vagueCount: vague.length,
      reasons,
    },
  };
}

/** One criterion with its verifier mark and, if vague, the hint. */
function describe(text: string, supplemented: boolean): ProposedCriterion {
  const vague = findVagueTerm(text);
  return {
    text,
    verifier: classifyVerifier(text),
    ...(vague ? { vague } : {}),
    ...(supplemented ? { supplemented: true } : {}),
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

/** `## 完了条件` (the heading roadmap-resolve writes) up to the next heading. */
const CRITERIA_SECTION = /^##\s*完了条件\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/m;
const CHECKLIST_ITEM = /^\s*[-*]\s*(?:\[[ xX]\]\s*)?(.+?)\s*$/;

/**
 * Read the checklist under a description's `## 完了条件` heading.
 *
 * Only that heading: it is the one `composeDescription` writes, so the text the
 * user approved on the roadmap card is exactly what this reads back.
 *
 * @param description - A task description / タスク説明文
 * @returns The listed criteria, or empty / 列挙された完了条件（無ければ空）
 */
export function criteriaFromDescription(description: string | undefined): string[] {
  if (!description) return [];
  const section = CRITERIA_SECTION.exec(description);
  if (!section) return [];
  const items = section[1]
    .split('\n')
    .map((line) => CHECKLIST_ITEM.exec(line)?.[1])
    .filter((item): item is string => !!item);
  return normalizeCriteria(items);
}

/**
 * A description with its `## 完了条件` section taken out.
 *
 * Used when the criteria a step ends up with differ from the checklist it was
 * sent with (supplemented to the minimum), so the description can be
 * re-composed and the column and the text the user reads stay the same.
 *
 * @param description - A task description / タスク説明文
 * @returns The description without that section, trimmed / 完了条件節を除いた説明文
 */
export function withoutCriteriaSection(description: string): string {
  return description.replace(CRITERIA_SECTION, '').trim();
}

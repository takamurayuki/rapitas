/**
 * CriteriaProposal
 *
 * Makes sure every task ラピ files arrives with a definition of done the user
 * has seen (companion design ch.7 stage 1, item 1). The jury, the self-check
 * and the landing classifier all read `Task.acceptanceCriteria`; a task filed
 * with that column empty is classified `criteria_missing` and judged against
 * "the plan's intent" instead of anything the user agreed to.
 *
 * Three jobs: tidy a proposed list, fall back to a criterion derived from the
 * title when the model proposed none (so the confirmation card always has
 * something to confirm), and read the `## 完了条件` checklist a roadmap step
 * description carries, for clients that send only the description.
 *
 * Pure — no database, no model. Not responsible for refusing a write; the
 * routes do that.
 */

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

/**
 * A criterion to show when nothing better was proposed.
 *
 * Deliberately plain and phrased as something the user checks: it is a
 * starting point on the confirmation card, not a claim that ラピ knows what
 * done means for this task.
 *
 * @param title - The task title / タスク名
 * @returns One fallback criterion / 代わりの完了条件1件
 */
export function fallbackCriterion(title: string): string {
  const name = title.trim().slice(0, 120) || 'このタスク';
  return `「${name}」で求められている成果ができあがり、その内容を本人が確かめられる状態になっている`;
}

/**
 * The proposed criteria, or a fallback when the proposal had none.
 *
 * @param proposed - Criteria the reader produced / 読み取った完了条件
 * @param title - Task title, for the fallback / タスク名（代案用）
 * @returns The criteria to put on the card, and whether they are the fallback / カードに出す完了条件と代案かどうか
 */
export function ensureProposedCriteria(
  proposed: unknown,
  title: string,
): { criteria: string[]; fallback: boolean } {
  const criteria = normalizeCriteria(proposed);
  if (criteria.length > 0) return { criteria, fallback: false };
  return { criteria: [fallbackCriterion(title)], fallback: true };
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

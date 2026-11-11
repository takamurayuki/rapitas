/**
 * CriteriaText
 *
 * Text-level helpers for completion criteria: normalising a sent list, and
 * reading or removing the `## 完了条件` checklist a roadmap step description
 * carries (the heading `composeDescription` writes). Pure; re-exported by
 * `criteria-proposal.ts`, which is where callers import them from.
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

/**
 * CriteriaText
 *
 * Text-level helpers for completion criteria: normalising a sent list,
 * reading or removing the `## 完了条件` checklist a task description carries,
 * composing it, and writing the description a task is stored with (only the
 * jury's criteria in it). Pure; re-exported by `criteria-proposal.ts`, which is
 * where callers import them from.
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
const CRITERIA_SECTION_ALL = new RegExp(CRITERIA_SECTION.source, 'gm');
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
  // NOTE: Every such section, not only the first: a client that appended its
  // own checklist to one already there would otherwise keep the older list —
  // and with it a person's check — in the stored text (review fix3 item 1).
  return description.replace(CRITERIA_SECTION_ALL, '').trim();
}

/**
 * Compose a task description from what to do and what counts as done.
 *
 * Built on the server rather than on screen so the text the user approves is
 * character-for-character the text that becomes the task.
 *
 * @param action - The one thing to do / やること
 * @param done - What finished looks like / 完了条件
 * @returns The description, or empty when there is nothing to say / 説明文
 */
export function composeDescription(action: string, done: string[]): string {
  const parts: string[] = [];
  if (action.trim()) parts.push(action.trim());
  const conditions = done.map((d) => d.trim()).filter(Boolean);
  // No heading without conditions under it: an empty "完了条件" reads as
  // "there are none", which is not what a missing field means.
  if (conditions.length > 0) {
    parts.push(['## 完了条件', ...conditions.map((c) => `- [ ] ${c}`)].join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * The description a task is stored with: its `## 完了条件` lists the jury's
 * criteria only, and no line anywhere repeats one of the person's checks.
 *
 * The description is handed to the jury, the workflow agents and replanning
 * verbatim, so a person's check left in it reaches the jury however the
 * columns were split (review fix3 item 1). The columns are the source of
 * truth; this keeps the text from contradicting them.
 *
 * @param description - The description as sent / 送られた説明文
 * @param split - The confirmed criteria, split by verifier / 判定者で分けた確定済みの条件
 * @param options - `section: 'always'` re-composes the checklist even when the
 *   text had none (roadmap steps); `'ifPresent'` only rewrites one that is there
 *   (task-create, whose description never carried one before) / 節を作る条件
 * @returns The description to store / 保存する説明文
 */
export function descriptionForJury(
  description: string,
  split: { acceptanceCriteria: string[]; userAcceptanceChecks: string[] },
  options: { section: 'always' | 'ifPresent' },
): string {
  const hadSection = CRITERIA_SECTION.test(description);
  const person = new Set(split.userAcceptanceChecks.map((c) => c.trim()));
  const body = withoutCriteriaSection(description);
  const lines = body.split('\n');
  const kept = lines.filter((line) => {
    const item = CHECKLIST_ITEM.exec(line)?.[1];
    return !(item && person.has(item.trim()));
  });
  if (!hadSection && kept.length === lines.length && options.section === 'ifPresent') {
    // Nothing to change: keep the text byte for byte.
    return description;
  }
  const cleaned = kept.join('\n');
  return hadSection || options.section === 'always'
    ? composeDescription(cleaned, split.acceptanceCriteria)
    : cleaned.trim();
}

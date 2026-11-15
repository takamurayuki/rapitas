/**
 * criteria-autofix
 *
 * The first layer of the check before a task starts (#1561): writing
 * mistakes that failed runs have proven costly are rewritten into a fixed
 * form, with no person and no model call. Only rules with a record behind
 * them belong here — anything less certain goes to the AI review and earns
 * its way in by being right there (docs/design/task-spec-writing.md).
 *
 * | rule | record | rewrite |
 * | unreachable | #1280, #1283 looped verify forever | moved to the handoff; verify.md must state it |
 * | whole_suite | trial task #1498 | compared with the state before the change |
 * | no_unchanged_route | #1244 stopped after 6 repairs | the "nothing to change" ending added |
 *
 * Pure. Not responsible for writing the result (`intake-criteria-check.ts`).
 */
import { findCriterionIssues, findSpecIssues } from '../assistant/criteria-rules';

/** Replaces the criteria moved to the handoff: the agent's part is to say what to check. */
export const HANDOFF_CRITERION =
  '作業中には確かめられない確認事項（説明の「申し送り」）を、確認してほしいこととして verify.md に書いている';

/** Added to a report-shaped task with no ending for "nothing needs changing". */
export const UNCHANGED_ROUTE_CRITERION =
  '直す必要がないと分かった場合は、verify.md に「## 結論: 修正不要」とその根拠を書いて完了とする';

const BASELINE_CLAUSE =
  '（変更前に通っていたテストが変更後もすべて通り、新しく足したテストがすべて通ればよい。変更前から落ちているテストは、件数と原因を verify.md に書く）';

/** One rewrite, for the record and the person. */
export interface CriteriaFix {
  rule: 'unreachable' | 'whole_suite' | 'no_unchanged_route';
  before: string | null;
  after: string | null;
}

/** What {@link autoFixCriteria} reads. */
export interface AutoFixInput {
  title: string;
  description: string | null;
  acceptanceCriteria: string[];
}

/** The rewritten criteria, what moved to the handoff, and each change. */
export interface AutoFixResult {
  acceptanceCriteria: string[];
  handoffs: string[];
  changes: CriteriaFix[];
}

/**
 * Rewrite the evidence-backed mistakes in a task's acceptance criteria.
 *
 * @param spec - Title, description and the acceptance criteria / タスクの仕様
 * @returns The fixed criteria, the handoff items and the changes / 修正結果
 */
export function autoFixCriteria(spec: AutoFixInput): AutoFixResult {
  const out: string[] = [];
  const handoffs: string[] = [];
  const changes: CriteriaFix[] = [];

  for (const text of spec.acceptanceCriteria) {
    const codes = findCriterionIssues(text, 'jury').map((i) => i.code);
    if (codes.includes('unreachable')) {
      handoffs.push(text);
      changes.push({ rule: 'unreachable', before: text, after: null });
      continue;
    }
    if (codes.includes('whole_suite')) {
      const after = `${text}${BASELINE_CLAUSE}`;
      out.push(after);
      changes.push({ rule: 'whole_suite', before: text, after });
      continue;
    }
    out.push(text);
  }
  if (handoffs.length > 0 && !out.includes(HANDOFF_CRITERION)) out.push(HANDOFF_CRITERION);

  const specIssues = findSpecIssues({
    title: spec.title,
    description: spec.description,
    acceptanceCriteria: out,
  });
  if (specIssues.some((i) => i.code === 'no_unchanged_route')) {
    out.push(UNCHANGED_ROUTE_CRITERION);
    changes.push({ rule: 'no_unchanged_route', before: null, after: UNCHANGED_ROUTE_CRITERION });
  }
  return { acceptanceCriteria: out, handoffs, changes };
}

/**
 * The description with the handoff items appended under their own heading.
 *
 * @param description - Current description / 現在の説明
 * @param handoffs - Items moved out of the criteria / 申し送りに移した項目
 * @returns The new description / 新しい説明
 */
export function withHandoff(description: string | null, handoffs: string[]): string {
  const block = [
    '## 申し送り（作業中には確かめられないため、完了条件から外した確認事項）',
    ...handoffs.map((h) => `- ${h}`),
  ].join('\n');
  return description && description.trim() ? `${description.trimEnd()}\n\n${block}` : block;
}

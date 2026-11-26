/**
 * plan-size-policy
 *
 * Defines how large a plan.md may be before the planner is told to split the
 * surplus into independent follow-up tasks, measures a plan against that
 * guideline, and supplies the planner instruction text (ja/en).
 * Not responsible for subtask splitting (see subtask-split-policy.ts, which
 * stays untouched) nor for rejecting oversized plans — oversize is only logged.
 */

import { parsePlanFiles } from '../agents/verification/scope-check';

/**
 * Max checklist items in the plan's implementation-checklist section.
 * Observed: bounce-heavy tasks had large plans (trendline 1519: 9 bounces,
 * 514: 8, TempoRaid 1403: 50+ criteria); 10 keeps one fix round small. "Over"
 * means 11 or more — exactly 10 is allowed.
 */
export const PLAN_MAX_CHECKLIST_ITEMS = 10;

/**
 * Max files in the plan's files-to-change section (directories excluded).
 * Observed: task 1420 changed 50+ files, bounced 5+ times and cost ~$20; 15
 * is the point where a single review round stops being tractable. "Over"
 * means 16 or more — exactly 15 is allowed.
 */
export const PLAN_MAX_CHANGED_FILES = 15;

/** Measured size of a plan. / 計画の大きさ */
export interface PlanSize {
  checklistItems: number;
  changedFiles: number;
}

const CHECKLIST_HEADING_RE = /実装チェックリスト|implementation checklist/i;
const FILES_HEADING_RE = /変更予定ファイル|files? to (?:be )?(?:change|modif)/i;
const CHECKBOX_RE = /^\s*- \[[ xX]\]/;

/**
 * Returns the text of the first heading section whose title matches, up to the
 * next heading of the same or higher level (deeper sub-headings are included).
 */
function extractSection(content: string, titleRe: RegExp): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let level = 0;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (level === 0) {
      if (m && titleRe.test(m[2])) level = m[1].length;
      continue;
    }
    if (m && m[1].length <= level) break;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Measures a plan: checkbox items inside the implementation-checklist section
 * and files inside the files-to-change section (not the whole document).
 *
 * @param content - plan.md text / plan.md の内容
 * @returns Item and file counts / チェックリスト項目数と変更予定ファイル数
 */
export function measurePlanSize(content: string): PlanSize {
  const checklistItems = extractSection(content, CHECKLIST_HEADING_RE)
    .split('\n')
    .filter((l) => CHECKBOX_RE.test(l)).length;
  // parsePlanFiles also returns parent directories (trailing '/'), which would
  // roughly double the count — only real files are counted.
  const changedFiles = parsePlanFiles(extractSection(content, FILES_HEADING_RE)).filter(
    (p) => !p.endsWith('/'),
  ).length;
  return { checklistItems, changedFiles };
}

/**
 * Whether either measure exceeds its guideline (OR; the boundary is allowed).
 *
 * @param size - Result of measurePlanSize / 計測結果
 * @returns true when the plan is over the guideline / 目安超過か
 */
export function isPlanOversized(size: PlanSize): boolean {
  return (
    size.checklistItems > PLAN_MAX_CHECKLIST_ITEMS || size.changedFiles > PLAN_MAX_CHANGED_FILES
  );
}

/** Planner instruction text, injected into planner.instruction. */
export const PLAN_SIZE_GUIDANCE: Readonly<Record<'ja' | 'en', string>> = {
  ja:
    `## 計画の大きさの目安\n` +
    `実装チェックリストが${PLAN_MAX_CHECKLIST_ITEMS}項目を超える、または変更予定ファイルが${PLAN_MAX_CHANGED_FILES}件を超える計画は、差し戻しが増えます。` +
    `超えそうなときは、中核の範囲だけを今回の計画に残し、残りを同じテーマの独立した後続タスクとして起票してください。\n` +
    `- 起票は \`POST /tasks\` で行い、サブタスクではなく parentId を付けない通常のタスクにします（親子関係は作りません）。\n` +
    `- 自動実行の対象にするため、元タスクと同じ \`themeId\` を必ず付けます。\n` +
    `- 後続タスクの本文に、元のタスク番号と、今回の計画に何を残したかを書きます。\n` +
    `- 計画を再保存するときは、起票済みの後続タスクを重複して起票しません。`,
  en:
    `## Plan size guideline\n` +
    `Plans with more than ${PLAN_MAX_CHECKLIST_ITEMS} implementation checklist items or more than ${PLAN_MAX_CHANGED_FILES} files to change cause more bounces. ` +
    `When the plan would exceed that, keep only the core scope in this plan and file the rest as independent follow-up tasks on the same theme.\n` +
    `- File each with \`POST /tasks\` as an ordinary task without parentId — not a subtask; do not create a parent/child link.\n` +
    `- Always set the same \`themeId\` as the original task so auto-run can pick it up.\n` +
    `- In each follow-up's body, write the original task number and what this plan kept.\n` +
    `- When re-saving the plan, do not file follow-up tasks that were already filed.`,
};

/**
 * Workflow Role Prompt — Acceptance Block
 *
 * Renders a task's explicit acceptance criteria as the numbered block appended
 * to the task-info prompt. Split out of workflow-role-prompts.ts (300-line
 * threshold); not responsible for resolving which criteria apply.
 */
import { resolveAcceptanceCriteria } from '../agents/verification/acceptance-self-check';

/**
 * Build the acceptance-criteria block, or an empty string when there are none.
 *
 * @param task - Task fields the criteria are resolved from / 受入条件を引くタスク項目
 * @param language - Output language / 出力言語
 * @returns Block text starting with a blank line, or '' / 受入条件ブロック
 */
export function buildAcceptanceBlock(
  task: { title: string; description: string | null; acceptanceCriteria?: string | null },
  language: 'ja' | 'en',
): string {
  const criteria = resolveAcceptanceCriteria(task);
  return criteria.length
    ? '\n\n' +
        (language === 'ja'
          ? '## 明示された受入条件\n以下の各条件を計画・実装・検証に対応づけてください。調査結果や過去の計画を理由に省略しないでください。既存計画との矛盾や欠落は完了扱いせず報告し、正規の再計画経路で解消してください。\n'
          : '## Explicit acceptance criteria\nMap every criterion to planning, implementation and verification. Do not omit criteria based on prior research or plans. Report contradictions or omissions in an existing plan and resolve them through the supported replanning flow before claiming completion.\n') +
        criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '';
}

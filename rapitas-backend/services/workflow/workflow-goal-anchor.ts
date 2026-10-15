/**
 * Workflow Goal Anchor
 *
 * Builds the implementer's goal-anchor block (task purpose + structured goals
 * + acceptance criteria) from the task row. Does not assemble the full
 * implementer context — that is workflow-implementer-context's job.
 */
import { prisma } from '../../config/database';

/**
 * Build the implementer's GOAL ANCHOR (R7): a compact restatement of the
 * task's purpose + structured goals + acceptance criteria, placed at the head
 * of the context with an instruction to re-align against it before each
 * change. Counters goal drift in long contexts (every model degrades past
 * ~100k tokens, arXiv:2505.02709; ReflAct-style goal re-alignment +27.7%,
 * arXiv:2505.15182). Returns '' when the task has no structured spec beyond
 * the title (the taskInfo block already carries title/description).
 *
 * @param taskId - Task id. / タスクID
 * @param task - Task title/description already in taskInfo. / タスク情報
 * @param language - Output language. / 出力言語
 * @returns The anchor block, or ''. / アンカーブロック
 */
export async function buildGoalAnchor(
  taskId: number,
  task: { title: string },
  language: 'ja' | 'en',
): Promise<string> {
  const row = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { goals: true, acceptanceCriteria: true },
    })
    .catch(() => null);
  const parseArr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (typeof v === 'string' && v.trim()) {
      try {
        const p: unknown = JSON.parse(v);
        return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  const goals = parseArr(row?.goals);
  const criteria = parseArr(row?.acceptanceCriteria);
  if (goals.length === 0 && criteria.length === 0) return '';

  if (language === 'ja') {
    return [
      '## ゴールアンカー（作業中は常にここへ立ち返ること）',
      `- 目的: ${task.title}`,
      ...(goals.length > 0 ? ['- ゴール:', ...goals.map((g) => `  - ${g}`)] : []),
      ...(criteria.length > 0 ? ['- 受け入れ基準:', ...criteria.map((c) => `  - ${c}`)] : []),
      '各変更の前に「この変更は上記ゴール・受け入れ基準に直結しているか」を確認してください。直結しない改善・リファクタ・スコープ外変更は行わないこと。',
    ].join('\n');
  }
  return [
    '## Goal anchor (return to this constantly while working)',
    `- Purpose: ${task.title}`,
    ...(goals.length > 0 ? ['- Goals:', ...goals.map((g) => `  - ${g}`)] : []),
    ...(criteria.length > 0 ? ['- Acceptance criteria:', ...criteria.map((c) => `  - ${c}`)] : []),
    'Before each change, confirm it directly serves the goals/criteria above. Do not make unrelated improvements, refactors, or out-of-scope changes.',
  ].join('\n');
}

/**
 * Workflow Goal Anchor
 *
 * Builds the implementer's goal-anchor block (task purpose + structured goals
 * + acceptance criteria) from the task row. Does not assemble the full
 * implementer context — that is workflow-implementer-context's job.
 */
import { prisma } from '../../config/database';
import { parseDeliverable, type Deliverable } from '../task/task-spec-requirements';

const DELIVERABLE_JA: Record<Deliverable, string> = {
  // NOTE: a PR is needed only when something changes (#1561): research may
  // show the change is unnecessary, and saying so is a valid ending.
  pr: 'PR（コードの変更）。調べた結果、変更が不要と分かったら、無理に変更せず verify.md に「## 結論: 修正不要」と根拠を書いて完了してよい',
  note: 'ノート（作業の結果をノートにまとめる）',
  report:
    '報告（verify.md に結果を書く。直す必要がなければ「## 結論: 修正不要」と根拠を書く。書かないと完了の判定で止まる）',
  decision:
    '判断（選択肢と推奨を verify.md に書く。コードの変更は求めない。変更しないときは「## 結論: 修正不要」と、判断が成果物であることを書く。書かないと完了の判定で止まる）',
};

const DELIVERABLE_EN: Record<Deliverable, string> = {
  pr: 'a PR (code change); if the work shows no change is needed, do not force one — write "## 結論: 修正不要" with the reasons in verify.md',
  note: 'a note summarising the result',
  report:
    'a report in verify.md; if nothing needs changing, write "## 結論: 修正不要" with the reasons',
  decision:
    'a decision: options and a recommendation in verify.md, no code change required; without a change, write "## 結論: 修正不要" stating the decision is the deliverable, or the completion check stops it',
};

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
  // NOTE: no select, read through a narrow type — like intake-gate's row: a
  // client generated before outOfScope / deliverable existed (#1555) reads
  // them as undefined instead of failing to compile or throwing.
  type AnchorRow = {
    parentId?: number | null;
    goals?: unknown;
    acceptanceCriteria?: unknown;
    outOfScope?: unknown;
    deliverable?: unknown;
    startConditions?: unknown;
  } | null;
  const read = async (id: number) =>
    (await prisma.task.findUnique({ where: { id } }).catch(() => null)) as AnchorRow;
  const row = await read(taskId);
  // A subtask is a step of its parent (#1559): it works toward the parent's
  // goals, inside the parent's scope, toward the parent's deliverable.
  const parent = row?.parentId ? await read(row.parentId) : null;
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
  const own = (v: unknown, fallback: unknown) => (parseArr(v).length > 0 ? v : fallback);
  const goals = parseArr(own(row?.goals, parent?.goals));
  const criteria = parseArr(own(row?.acceptanceCriteria, parent?.acceptanceCriteria));
  if (goals.length === 0 && criteria.length === 0) return '';
  // 範囲外 and 成果物 (#1555): what not to touch keeps a change from widening,
  // and a report or a decision may rightly end with no code change.
  const outOfScope = [...parseArr(row?.outOfScope), ...parseArr(parent?.outOfScope)];
  const deliverable = parseDeliverable(row?.deliverable ?? parent?.deliverable);
  // 開始条件 in words (#1559): what should already hold. An agent that finds
  // one does not hold should say so rather than build on it.
  const startConditions = parseArr(row?.startConditions);

  if (language === 'ja') {
    return [
      '## ゴールアンカー（作業中は常にここへ立ち返ること）',
      `- 目的: ${task.title}`,
      ...(goals.length > 0 ? ['- ゴール:', ...goals.map((g) => `  - ${g}`)] : []),
      ...(criteria.length > 0 ? ['- 受け入れ基準:', ...criteria.map((c) => `  - ${c}`)] : []),
      ...(outOfScope.length > 0
        ? ['- 範囲外（触れないこと）:', ...outOfScope.map((o) => `  - ${o}`)]
        : []),
      `- 成果物: ${DELIVERABLE_JA[deliverable]}`,
      ...(startConditions.length > 0
        ? [
            '- 開始条件（着手前に満たされているはず。満たされていなければ作業せず verify.md に報告）:',
            ...startConditions.map((c) => `  - ${c}`),
          ]
        : []),
      '各変更の前に「この変更は上記ゴール・受け入れ基準に直結しているか」を確認してください。直結しない改善・リファクタ・スコープ外変更は行わないこと。',
    ].join('\n');
  }
  return [
    '## Goal anchor (return to this constantly while working)',
    `- Purpose: ${task.title}`,
    ...(goals.length > 0 ? ['- Goals:', ...goals.map((g) => `  - ${g}`)] : []),
    ...(criteria.length > 0 ? ['- Acceptance criteria:', ...criteria.map((c) => `  - ${c}`)] : []),
    ...(outOfScope.length > 0
      ? ['- Out of scope (do not touch):', ...outOfScope.map((o) => `  - ${o}`)]
      : []),
    `- Deliverable: ${DELIVERABLE_EN[deliverable]}`,
    ...(startConditions.length > 0
      ? [
          '- Start conditions (should already hold; if one does not, report it in verify.md instead of building on it):',
          ...startConditions.map((c) => `  - ${c}`),
        ]
      : []),
    'Before each change, confirm it directly serves the goals/criteria above. Do not make unrelated improvements, refactors, or out-of-scope changes.',
  ].join('\n');
}

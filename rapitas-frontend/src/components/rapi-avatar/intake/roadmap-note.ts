/**
 * RoadmapNote
 *
 * The note that closes a roadmap: what was decided, where the work went,
 * and links to every task that was created.
 *
 * Pure, and separate from the component, because it is the one part of the
 * flow whose output a person reads weeks later. The questions come from the
 * round that asked them rather than from the plan on screen — the final
 * round deliberately asks nothing, so by the time the tasks exist the
 * questions are only here.
 *
 * Not responsible for storing it — notes live in the browser's own storage
 * and the component owns that.
 */

/** A question that was asked, and what the user picked. */
export interface NoteDecision {
  question: string;
  answer: string;
}

/** A step as the approved plan dated it. */
export interface NoteStep {
  title: string;
  dueDate?: string;
}

/** Where a task opens from the note. Headered, per the task-link rule. */
const taskHref = (id: number) => `/tasks/${id}?showHeader=true`;

/**
 * Compose the closing note for a roadmap that has just been created.
 *
 * @param input - The goal, the decisions, the placement and what was made / 目標・決定・配置・作成物
 * @returns The note body in markdown / ノート本文（Markdown）
 */
export function composeRoadmapNote(input: {
  goal: string;
  decisions: NoteDecision[];
  theme: string;
  project: string;
  deadline?: string;
  steps: NoteStep[];
  taskIds: number[];
  assumptions?: string[];
  comparisonAxes?: string[];
}): string {
  const lines: string[] = [`# ${input.goal}`, ''];

  if (input.deadline) lines.push(`期限: ${input.deadline}`, '');

  if (input.assumptions && input.assumptions.length > 0) {
    lines.push('## 前提', ...input.assumptions.map((a) => `- ${a}`), '');
  }

  if (input.comparisonAxes && input.comparisonAxes.length > 0) {
    // Columns, and nothing in them. She cannot look up a salary or a review
    // from here, so anything filled in would be invented — and an invented
    // number in a note is read later as a fact.
    const header = `| 候補 | ${input.comparisonAxes.join(' | ')} |`;
    const rule = `|${' --- |'.repeat(input.comparisonAxes.length + 1)}`;
    const blank = `|${'  |'.repeat(input.comparisonAxes.length + 1)}`;
    lines.push('## 比較', header, rule, blank, blank, '');
  }

  if (input.decisions.length > 0) {
    lines.push('## 決めたこと', ...input.decisions.map((d) => `- ${d.question} → ${d.answer}`), '');
  }

  lines.push('## 置き場所', `- テーマ: ${input.theme}`, `- プロジェクト: ${input.project}`, '');

  lines.push(
    '## 作ったタスク',
    ...input.taskIds.map((id, i) => {
      const step = input.steps[i];
      // The date belongs beside the link: the note is where someone looks
      // to see the shape of the plan without opening nine tasks.
      const due = step?.dueDate ? ` — ${step.dueDate}` : '';
      return `- [${step?.title ?? id}](${taskHref(id)})${due}`;
    }),
  );

  return lines.join('\n');
}

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

/** Something the search found, and the page it came from. */
export interface NoteCandidate {
  name: string;
  sourceUrl: string;
  /** Axis name to what the search established. Missing means not found. */
  values: Record<string, string>;
  why: string;
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
  /** What was looked up, if anything was. / 調べた候補 */
  candidates?: NoteCandidate[];
  /** Axes the search could not fill for anyone. / 調べても埋まらなかった観点 */
  unresolvedAxes?: string[];
}): string {
  const lines: string[] = [`# ${input.goal}`, ''];

  if (input.deadline) lines.push(`期限: ${input.deadline}`, '');

  if (input.assumptions && input.assumptions.length > 0) {
    lines.push('## 前提', ...input.assumptions.map((a) => `- ${a}`), '');
  }

  if (input.comparisonAxes && input.comparisonAxes.length > 0) {
    const axes = input.comparisonAxes;
    const found = input.candidates ?? [];
    // A cell is filled only where the search established it. An empty one
    // is the honest answer: an invented number in a note is read months
    // later as a fact, and nothing on the page says where it came from.
    const row = (c: NoteCandidate) =>
      `| [${c.name}](${c.sourceUrl}) | ${axes.map((a) => c.values[a] ?? '').join(' | ')} |`;
    const blank = `|${'  |'.repeat(axes.length + 1)}`;
    lines.push(
      '## 比較',
      `| 候補 | ${axes.join(' | ')} |`,
      `|${' --- |'.repeat(axes.length + 1)}`,
      ...found.map(row),
      // Always one empty row: the list is a starting point, not the market.
      blank,
      '',
    );
    const why = found.filter((c) => c.why);
    if (why.length > 0) {
      lines.push(...why.map((c) => `- ${c.name}: ${c.why}`), '');
    }
    if (input.unresolvedAxes && input.unresolvedAxes.length > 0) {
      // Named rather than left as empty columns, so the gap is visibly a
      // gap and not an oversight.
      lines.push(`調べても分からなかった観点: ${input.unresolvedAxes.join(' / ')}`, '');
    }
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

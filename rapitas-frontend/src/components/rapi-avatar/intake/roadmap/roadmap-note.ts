/**
 * RoadmapNote
 *
 * The note that closes a roadmap: what was decided, where the work went,
 * and links to every task that was created.
 *
 * Composing it is pure and separate from the component, because it is the
 * one part of the flow whose output a person reads weeks later. The
 * questions come from the round that asked them rather than from the plan on
 * screen — the final round deliberately asks nothing, so by the time the
 * tasks exist the questions are only here.
 *
 * `saveRoadmapNote` stores it on the server and links it to every task the
 * roadmap made (design §5.3 step 8) — before stage 0 it lived only in this
 * browser's store and had no server links, so the phone never saw it.
 * Not responsible for the task descriptions (use-roadmap's attachNote).
 */

import { useNoteStore, type NoteTaskMeta } from '@/stores/note-store';
import { linkNoteOnServer, saveNoteOnServer } from '@/stores/note/note-api';

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

/** One task to hang the note off, with what the desktop tree needs to place it. */
export interface RoadmapNoteLink {
  taskId: number;
  meta: NoteTaskMeta;
}

/**
 * One link per created task, with the step title and the theme the desktop
 * tree places it under.
 *
 * @param taskIds - The created tasks, in step order / 作成したタスク（手順順）
 * @param steps - The plan's steps / 計画の手順
 * @param themeName - The theme's name, when there is one / テーマ名
 * @returns The links to make / 作る紐付け
 */
export function roadmapNoteLinks(
  taskIds: number[],
  steps: { title?: string }[],
  themeName?: string | null,
): RoadmapNoteLink[] {
  return taskIds.map((taskId, i) => {
    const taskTitle = steps[i]?.title;
    return {
      taskId,
      meta: { ...(taskTitle ? { taskTitle } : {}), ...(themeName ? { themeName } : {}) },
    };
  });
}

/** What was saved. */
export interface RoadmapNoteSaved {
  noteId: string;
  linkedTaskIds: number[];
}

/**
 * Save the note, then link it to each task. A failed link is skipped (the
 * note and the other links stand); a failed note save throws.
 *
 * @param title - The note title (the goal) / タイトル（目標）
 * @param content - The Markdown body / Markdown の本文
 * @param links - The tasks to link / 紐付けるタスク
 * @param now - Clock for the id, for tests / ID 用の時刻（テスト用）
 * @returns The note id and the tasks it is linked to / ノートIDと紐付いたタスク
 * @throws {Error} when the note itself was not saved / ノート自体を保存できなかったとき
 */
export async function saveRoadmapNote(
  title: string,
  content: string,
  links: RoadmapNoteLink[],
  now: () => number = Date.now,
): Promise<RoadmapNoteSaved> {
  // Same id shape the desktop store mints, so it reads like any other note.
  const noteId = now().toString();
  const saved = await saveNoteOnServer(noteId, { title, content });
  const linkedTaskIds: number[] = [];
  const linkedTaskMeta: Record<number, NoteTaskMeta> = {};
  for (const link of links) {
    try {
      await linkNoteOnServer(noteId, link.taskId, link.meta);
      linkedTaskIds.push(link.taskId);
      linkedTaskMeta[link.taskId] = link.meta;
    } catch {
      // Best-effort per task: the note exists, and the task still gets its chip.
    }
  }
  const store = useNoteStore.getState();
  store.upsertNote({ ...saved, linkedTaskIds, linkedTaskMeta });
  store.setCurrentNote(noteId);
  return { noteId, linkedTaskIds };
}

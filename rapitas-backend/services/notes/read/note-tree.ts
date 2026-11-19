/**
 * NoteTree
 *
 * `GET /notes/tree` (design §2.1, §2.2): the skeleton of the one tree —
 * categories → themes (→ task sections), カテゴリなし, memo folders, 未分類 —
 * with note counts and no bodies.
 *
 * Counting follows contract 2 and 3: a note is counted once, where
 * describePlacement puts it. Inside a theme, a task's section lists the notes
 * placed in that theme whose sourceTaskId is the task or that link to it;
 * notes placed elsewhere that link to (or came from) the task are shown in
 * the section as `elsewhere` (ids and a count only) and never counted in the
 * tree. A section belongs to the theme that is the task's effective theme.
 *
 * Reads only. Not responsible for the notes' contents — see note-query.
 */
import type { PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import { describePlacement, loadPlacementLookup } from '../placement/describe-placement';
import { resolveEffectiveTheme } from '../placement/effective-theme';
import { belongsTo, type ScopedTask } from '../placement/placement-scope';

/** One task's section inside a theme. */
export interface TreeSection {
  taskId: number;
  title: string;
  status: string;
  /** Notes placed in this theme for this task. */
  noteIds: string[];
  noteCount: number;
  /** Notes placed somewhere else that belong to this task: shown, not counted. */
  elsewhere: { count: number; noteIds: string[] };
}

/** A theme node. */
export interface TreeTheme {
  id: number;
  name: string;
  categoryId: number | null;
  /** Every note placed in the theme (each once). */
  noteCount: number;
  /** Placed in the theme but in no section of it (テーマ直下のメモ). */
  directNoteCount: number;
  sections: TreeSection[];
}

/** The whole skeleton. */
export interface NoteTree {
  categories: {
    id: number;
    name: string;
    /** Notes directly under the category (カテゴリ直下). */
    noteCount: number;
    themes: TreeTheme[];
  }[];
  /** Themes without a category (カテゴリなし). */
  uncategorized: { themes: TreeTheme[] };
  folders: { id: number; name: string; sortOrder: number; noteCount: number }[];
  unclassified: { noteCount: number };
  /** Every note in the workspace, which is the sum of all counts above. */
  total: number;
}

interface TreeNoteRow {
  id: string;
  themeId: number | null;
  categoryId: number | null;
  folderId: number | null;
  sourceTaskId: number | null;
  taskLinks?: { taskId: number }[];
}

interface TreeTaskRow extends ScopedTask {
  title: string;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
}

/** Due date first (none last), then creation order — L1's section order. */
function sectionOrder(a: TreeTaskRow, b: TreeTaskRow): number {
  const ad = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
  const bd = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  const ac = a.createdAt?.getTime?.() ?? 0;
  const bc = b.createdAt?.getTime?.() ?? 0;
  return ac !== bc ? ac - bc : a.id - b.id;
}

/**
 * Build the tree for the request's workspace.
 *
 * @param db - Client / クライアント
 * @returns The skeleton with counts / 件数付きの木
 */
export async function buildNoteTree(db: PrismaInstance): Promise<NoteTree> {
  const ws = requestWorkspaceId();
  const lookup = await loadPlacementLookup(db, {
    themeIds: 'all',
    categoryIds: 'all',
    folderIds: 'all',
  });
  const notes = (await db.note.findMany({
    where: { workspaceId: ws },
    select: {
      id: true,
      themeId: true,
      categoryId: true,
      folderId: true,
      sourceTaskId: true,
      taskLinks: { select: { taskId: true } },
    },
  })) as TreeNoteRow[];

  const tasksOf = (n: TreeNoteRow) => [
    ...new Set([
      ...(n.sourceTaskId != null ? [n.sourceTaskId] : []),
      ...(n.taskLinks ?? []).map((l) => l.taskId),
    ]),
  ];
  const taskIds = [...new Set(notes.flatMap(tasksOf))];
  const taskRows = (
    taskIds.length
      ? ((await db.task.findMany({
          where: { id: { in: taskIds }, workspaceId: ws },
          select: {
            id: true,
            workspaceId: true,
            themeId: true,
            parentId: true,
            title: true,
            status: true,
            dueDate: true,
            createdAt: true,
          },
        })) as TreeTaskRow[])
      : []
  ).filter((t) => belongsTo(t, ws));
  const tasks = new Map(taskRows.map((t) => [t.id, t]));
  const cache = new Map<number, ScopedTask | null>(taskRows.map((t) => [t.id, t]));
  const effective = new Map<number, number | null>();
  for (const t of taskRows) effective.set(t.id, await resolveEffectiveTheme(db, t.id, { cache }));

  const themeCount = new Map<number, number>();
  const themeDirect = new Map<number, number>();
  const categoryCount = new Map<number, number>();
  const folderCount = new Map<number, number>();
  const sections = new Map<string, TreeSection>();
  let unclassified = 0;
  const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
  const section = (themeId: number, task: TreeTaskRow): TreeSection => {
    const key = `${themeId}:${task.id}`;
    let s = sections.get(key);
    if (!s) {
      s = {
        taskId: task.id,
        title: task.title,
        status: task.status,
        noteIds: [],
        noteCount: 0,
        elsewhere: { count: 0, noteIds: [] },
      };
      sections.set(key, s);
    }
    return s;
  };

  for (const note of notes) {
    const placement = describePlacement(note, lookup);
    const placedTheme = placement.kind === 'theme' ? (placement.themeId as number) : null;
    if (placement.kind === 'theme') bump(themeCount, placedTheme as number);
    else if (placement.kind === 'category') bump(categoryCount, placement.categoryId as number);
    else if (placement.kind === 'folder') bump(folderCount, placement.folderId as number);
    else unclassified += 1;

    let inSection = false;
    for (const taskId of tasksOf(note)) {
      const task = tasks.get(taskId);
      const eff = task ? effective.get(taskId) : null;
      if (!task || eff == null || !lookup.themes.has(eff)) continue;
      const s = section(eff, task);
      if (eff === placedTheme) {
        s.noteIds.push(note.id);
        s.noteCount += 1;
        inSection = true;
      } else {
        s.elsewhere.noteIds.push(note.id);
        s.elsewhere.count += 1;
      }
    }
    if (placedTheme !== null && !inSection) bump(themeDirect, placedTheme);
  }

  const themeNode = (t: { id: number; name: string; categoryId: number | null }): TreeTheme => ({
    id: t.id,
    name: t.name,
    categoryId: t.categoryId !== null && lookup.categories.has(t.categoryId) ? t.categoryId : null,
    noteCount: themeCount.get(t.id) ?? 0,
    directNoteCount: themeDirect.get(t.id) ?? 0,
    sections: [...sections.entries()]
      .filter(([key]) => key.startsWith(`${t.id}:`))
      .map(([, s]) => s)
      .sort((a, b) =>
        sectionOrder(tasks.get(a.taskId) as TreeTaskRow, tasks.get(b.taskId) as TreeTaskRow),
      ),
  });
  const themes = [...lookup.themes.values()].map(themeNode);
  return {
    categories: [...lookup.categories.values()].map((c) => ({
      id: c.id,
      name: c.name,
      noteCount: categoryCount.get(c.id) ?? 0,
      themes: themes.filter((t) => t.categoryId === c.id),
    })),
    uncategorized: { themes: themes.filter((t) => t.categoryId === null) },
    folders: [...lookup.folders.values()].map((f) => ({
      id: f.id,
      name: f.name,
      sortOrder: f.sortOrder ?? 0,
      noteCount: folderCount.get(f.id) ?? 0,
    })),
    unclassified: { noteCount: unclassified },
    total: notes.length,
  };
}

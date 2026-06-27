/**
 * note-tree-utils
 *
 * Builds a Category → Theme → Task → Notes hierarchy from the note store.
 *
 * Two hierarchy depths are supported:
 *  - 3-level: category + theme + task  (notes linked to tasks that have both)
 *  - 2-level: theme + task             (notes linked to tasks without a category)
 *
 * Primary source: explicit `linkedTaskMeta` stored when linking from a task.
 * Fallback: title parsing for notes created before meta was introduced.
 *   3-level title: "Category > Theme > [#N]_TaskTitle"
 *   2-level title: "Theme > [#N]_TaskTitle"
 */

import type { Note } from '@/stores/note-store';

export interface NoteTaskGroup {
  taskId: number;
  taskLabel: string;
  notes: Note[];
}

export interface NoteThemeGroup {
  theme: string;
  tasks: NoteTaskGroup[];
}

export interface NoteCategoryGroup {
  category: string;
  themes: NoteThemeGroup[];
}

/** Top-level group for notes whose tasks have a theme but no category. */
export interface NoteThemeTaskGroup {
  theme: string;
  tasks: NoteTaskGroup[];
}

export interface NoteTree {
  /** 3-level nodes: category → theme → task → notes */
  categories: NoteCategoryGroup[];
  /** 2-level nodes: theme → task → notes (no category) */
  themeGroups: NoteThemeTaskGroup[];
  /** Notes not placed in any task hierarchy. */
  standalone: Note[];
}

// ── Internal map types ──────────────────────────────────────────────────────
type CatMap = Map<string, Map<string, Map<number, { label: string; notes: Note[] }>>>;
type ThemeMap = Map<string, Map<number, { label: string; notes: Note[] }>>;

function addToCategories(
  catMap: CatMap,
  categoryName: string,
  themeName: string,
  taskId: number,
  taskLabel: string,
  note: Note,
) {
  if (!catMap.has(categoryName)) catMap.set(categoryName, new Map());
  const themeMap = catMap.get(categoryName)!;
  if (!themeMap.has(themeName)) themeMap.set(themeName, new Map());
  const taskMap = themeMap.get(themeName)!;
  if (!taskMap.has(taskId)) taskMap.set(taskId, { label: taskLabel, notes: [] });
  taskMap.get(taskId)!.notes.push(note);
}

function addToThemeGroups(
  themeMap: ThemeMap,
  themeName: string,
  taskId: number,
  taskLabel: string,
  note: Note,
) {
  if (!themeMap.has(themeName)) themeMap.set(themeName, new Map());
  const taskMap = themeMap.get(themeName)!;
  if (!taskMap.has(taskId)) taskMap.set(taskId, { label: taskLabel, notes: [] });
  taskMap.get(taskId)!.notes.push(note);
}

// ── Title parsing ────────────────────────────────────────────────────────────

/**
 * Parse a 3-segment title: "Category > Theme > [#N]_rest".
 *
 * @param title - Note title / ノートタイトル
 * @returns Parsed path or null
 */
export function parseNotePath(title: string): {
  category: string;
  theme: string;
  taskId: number;
  taskLabel: string;
} | null {
  const match = title.match(/^(.+?)\s*>\s*(.+?)\s*>\s*\[#(\d+)\](.*)$/);
  if (!match) return null;
  return {
    category: match[1].trim(),
    theme: match[2].trim(),
    taskId: parseInt(match[3], 10),
    taskLabel: `[#${match[3]}]${match[4]}`,
  };
}

/**
 * Parse a 2-segment title: "Theme > [#N]_rest" (task without category).
 *
 * @param title - Note title / ノートタイトル
 * @returns Parsed path or null
 */
export function parseNotePathThemeOnly(title: string): {
  theme: string;
  taskId: number;
  taskLabel: string;
} | null {
  // Must NOT match the 3-segment pattern (already handled by parseNotePath).
  if (/^(.+?)\s*>\s*(.+?)\s*>\s*\[#\d+\]/.test(title)) return null;
  const match = title.match(/^(.+?)\s*>\s*\[#(\d+)\](.*)$/);
  if (!match) return null;
  return {
    theme: match[1].trim(),
    taskId: parseInt(match[2], 10),
    taskLabel: `[#${match[2]}]${match[3]}`,
  };
}

// ── Tree builder ─────────────────────────────────────────────────────────────

/**
 * Build a hierarchical tree from a flat note array.
 *
 * @param notes - Flat list of notes / 整理対象のノート一覧
 * @returns NoteTree with linked notes in hierarchy and the rest in standalone
 */
export function buildNoteTree(notes: Note[]): NoteTree {
  const catMap: CatMap = new Map();
  const themeMap: ThemeMap = new Map();
  const standalone: Note[] = [];

  for (const note of notes) {
    let addedToTree = false;

    // ── Primary: explicit linkedTaskMeta ──────────────────────────────────
    if (note.linkedTaskIds?.length && note.linkedTaskMeta) {
      for (const taskId of note.linkedTaskIds) {
        const meta = note.linkedTaskMeta[taskId];
        if (!meta) continue;

        if (meta.categoryName && meta.themeName) {
          addToCategories(catMap, meta.categoryName, meta.themeName, taskId, meta.taskTitle, note);
          addedToTree = true;
        } else if (meta.themeName) {
          addToThemeGroups(themeMap, meta.themeName, taskId, meta.taskTitle, note);
          addedToTree = true;
        }
      }
    }

    // ── Fallback: title parsing ───────────────────────────────────────────
    if (!addedToTree) {
      const parsed3 = parseNotePath(note.title);
      if (parsed3) {
        addToCategories(
          catMap,
          parsed3.category,
          parsed3.theme,
          parsed3.taskId,
          parsed3.taskLabel,
          note,
        );
        addedToTree = true;
      } else {
        const parsed2 = parseNotePathThemeOnly(note.title);
        if (parsed2) {
          addToThemeGroups(themeMap, parsed2.theme, parsed2.taskId, parsed2.taskLabel, note);
          addedToTree = true;
        }
      }
    }

    if (!addedToTree) standalone.push(note);
  }

  // ── Build output arrays ───────────────────────────────────────────────────
  const categories: NoteCategoryGroup[] = [];
  for (const [category, themesMap] of catMap) {
    const themes: NoteThemeGroup[] = [];
    for (const [theme, tasksMap] of themesMap) {
      const tasks: NoteTaskGroup[] = [];
      for (const [taskId, { label, notes: taskNotes }] of tasksMap) {
        tasks.push({ taskId, taskLabel: label, notes: taskNotes });
      }
      themes.push({ theme, tasks });
    }
    categories.push({ category, themes });
  }

  const themeGroups: NoteThemeTaskGroup[] = [];
  for (const [theme, tasksMap] of themeMap) {
    const tasks: NoteTaskGroup[] = [];
    for (const [taskId, { label, notes: taskNotes }] of tasksMap) {
      tasks.push({ taskId, taskLabel: label, notes: taskNotes });
    }
    themeGroups.push({ theme, tasks });
  }

  return { categories, themeGroups, standalone };
}

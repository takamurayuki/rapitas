/**
 * note-tree-utils
 *
 * Builds a Category → Theme → Task → Notes hierarchy from the note store.
 * Primary source: explicit `linkedTaskMeta` stored when linking from a task.
 * Fallback: title parsing for notes created before meta was introduced
 * (titles of the form "Category > Theme > [#N]_TaskTitle").
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

export interface NoteTree {
  categories: NoteCategoryGroup[];
  /** Notes not placed in any task hierarchy. */
  standalone: Note[];
}

/**
 * Parse a note title of the form "Category > Theme > [#N]_rest".
 * Used as a fallback for notes that predate the linkedTaskMeta field.
 *
 * @param title - The note title to parse / パース対象のノートタイトル
 * @returns Parsed path segments, or null if the title does not match
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

type CatMap = Map<string, Map<string, Map<number, { label: string; notes: Note[] }>>>;

function addToTree(
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

/**
 * Build a Category → Theme → Task → Notes tree from a flat note array.
 *
 * @param notes - Flat list of notes to organise / 整理対象のノート一覧
 * @returns NoteTree with linked notes in the hierarchy and the rest in standalone
 */
export function buildNoteTree(notes: Note[]): NoteTree {
  const catMap: CatMap = new Map();
  const standalone: Note[] = [];

  for (const note of notes) {
    let addedToTree = false;

    // Primary: explicit hierarchy metadata stored at link time
    if (note.linkedTaskIds?.length && note.linkedTaskMeta) {
      for (const taskId of note.linkedTaskIds) {
        const meta = note.linkedTaskMeta[taskId];
        if (!meta?.categoryName || !meta?.themeName) continue;
        addToTree(catMap, meta.categoryName, meta.themeName, taskId, meta.taskTitle, note);
        addedToTree = true;
      }
    }

    // Fallback: title parsing for pre-meta notes
    if (!addedToTree) {
      const parsed = parseNotePath(note.title);
      if (parsed) {
        addToTree(catMap, parsed.category, parsed.theme, parsed.taskId, parsed.taskLabel, note);
        addedToTree = true;
      }
    }

    if (!addedToTree) standalone.push(note);
  }

  const categories: NoteCategoryGroup[] = [];
  for (const [category, themeMap] of catMap) {
    const themes: NoteThemeGroup[] = [];
    for (const [theme, taskMap] of themeMap) {
      const tasks: NoteTaskGroup[] = [];
      for (const [taskId, { label, notes: taskNotes }] of taskMap) {
        tasks.push({ taskId, taskLabel: label, notes: taskNotes });
      }
      themes.push({ theme, tasks });
    }
    categories.push({ category, themes });
  }

  return { categories, standalone };
}

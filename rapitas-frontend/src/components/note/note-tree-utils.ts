/**
 * note-tree-utils
 *
 * Builds a Category → Theme → Task → Notes hierarchy from the note store.
 * Notes created via "タスクに紐づける" have titles of the form
 * "Category > Theme > [#N]_TaskTitle". This module parses that pattern
 * to organise notes into a navigable tree; all other notes land in
 * `standalone`.
 */

import type { Note } from '@/stores/note-store';

export interface NoteTaskGroup {
  taskId: number;
  /** The "[#N]_TaskTitle" portion of the original note title. */
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
  /** Notes whose titles do not match the "A > B > [#N]..." pattern. */
  standalone: Note[];
}

/**
 * Parse a note title of the form "Category > Theme > [#N]_rest".
 *
 * @param title - The note title to parse / パース対象のノートタイトル
 * @returns Parsed path segments, or null if the title does not match / パース結果またはnull
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
 * Build a Category → Theme → Task → Notes tree from a flat note array.
 *
 * @param notes - Flat list of notes to organise / 整理対象のノート一覧
 * @returns NoteTree with linked notes in the hierarchy and the rest in standalone
 */
export function buildNoteTree(notes: Note[]): NoteTree {
  // category → theme → taskId → { label, notes[] }
  const catMap = new Map<string, Map<string, Map<number, { label: string; notes: Note[] }>>>();
  const standalone: Note[] = [];

  for (const note of notes) {
    const parsed = parseNotePath(note.title);
    if (!parsed) {
      standalone.push(note);
      continue;
    }

    if (!catMap.has(parsed.category)) catMap.set(parsed.category, new Map());
    const themeMap = catMap.get(parsed.category)!;

    if (!themeMap.has(parsed.theme)) themeMap.set(parsed.theme, new Map());
    const taskMap = themeMap.get(parsed.theme)!;

    if (!taskMap.has(parsed.taskId)) {
      taskMap.set(parsed.taskId, { label: parsed.taskLabel, notes: [] });
    }
    taskMap.get(parsed.taskId)!.notes.push(note);
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

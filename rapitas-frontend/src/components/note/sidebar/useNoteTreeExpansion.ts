/**
 * useNoteTreeExpansion
 *
 * Which category / theme / task groups of the /notes sidebar tree are open:
 * everything opens while a search is active, and the path to the open note
 * opens when it changes. Split out of NoteSidebar.tsx; drawing the tree
 * stays there.
 */
import { useEffect, useState } from 'react';
import type { Note } from '@/stores/note-store';
import { parseNotePath, parseNotePathThemeOnly, type NoteTree } from '../note-tree-utils';

interface Options {
  tree: NoteTree;
  notes: Note[];
  currentNoteId: string | null;
  searchQuery: string;
}

function toggled(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Open/closed state of the sidebar tree's groups.
 *
 * @param options - The tree, the notes, the open note and the search / 木・ノート・開いているノート・検索語
 * @returns The open keys per level and a toggle per level / 階層ごとの開いているキーと切り替え
 */
export function useNoteTreeExpansion({ tree, notes, currentNoteId, searchQuery }: Options) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Auto-expand everything when a search is active so results are visible.
  useEffect(() => {
    if (searchQuery) {
      setExpandedCategories(new Set(tree.categories.map((c) => c.category)));
      setExpandedThemes(
        new Set([
          ...tree.categories.flatMap((c) => c.themes.map((t) => `${c.category}|||${t.theme}`)),
          ...tree.themeGroups.map((tg) => `theme:${tg.theme}`),
        ]),
      );
      setExpandedTasks(
        new Set([
          ...tree.categories.flatMap((c) =>
            c.themes.flatMap((t) =>
              t.tasks.map((tk) => `${c.category}|||${t.theme}|||${tk.taskId}`),
            ),
          ),
          ...tree.themeGroups.flatMap((tg) =>
            tg.tasks.map((tk) => `theme:${tg.theme}|||${tk.taskId}`),
          ),
        ]),
      );
    }
  }, [searchQuery, tree]);

  // Expand the path of the currently selected note.
  useEffect(() => {
    if (!currentNoteId) return;
    const activeNote = notes.find((n) => n.id === currentNoteId);
    if (!activeNote) return;

    // Primary: stored metadata
    if (activeNote.linkedTaskIds?.length && activeNote.linkedTaskMeta) {
      for (const taskId of activeNote.linkedTaskIds) {
        const meta = activeNote.linkedTaskMeta[taskId];
        if (!meta) continue;

        const { categoryName } = meta;
        if (categoryName && meta.themeName) {
          const themeKey = `${categoryName}|||${meta.themeName}`;
          const taskKey = `${themeKey}|||${taskId}`;
          setExpandedCategories((s) => new Set([...s, categoryName]));
          setExpandedThemes((s) => new Set([...s, themeKey]));
          setExpandedTasks((s) => new Set([...s, taskKey]));
        } else if (meta.themeName) {
          const themeKey = `theme:${meta.themeName}`;
          const taskKey = `${themeKey}|||${taskId}`;
          setExpandedThemes((s) => new Set([...s, themeKey]));
          setExpandedTasks((s) => new Set([...s, taskKey]));
        }
      }
      return;
    }

    // Fallback: title parsing
    const parsed3 = parseNotePath(activeNote.title);
    if (parsed3) {
      const themeKey = `${parsed3.category}|||${parsed3.theme}`;
      const taskKey = `${themeKey}|||${parsed3.taskId}`;
      setExpandedCategories((s) => new Set([...s, parsed3.category]));
      setExpandedThemes((s) => new Set([...s, themeKey]));
      setExpandedTasks((s) => new Set([...s, taskKey]));
      return;
    }
    const parsed2 = parseNotePathThemeOnly(activeNote.title);
    if (parsed2) {
      const themeKey = `theme:${parsed2.theme}`;
      const taskKey = `${themeKey}|||${parsed2.taskId}`;
      setExpandedThemes((s) => new Set([...s, themeKey]));
      setExpandedTasks((s) => new Set([...s, taskKey]));
    }
  }, [currentNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    expandedCategories,
    expandedThemes,
    expandedTasks,
    toggleCategory: (key: string) => setExpandedCategories((s) => toggled(s, key)),
    toggleTheme: (key: string) => setExpandedThemes((s) => toggled(s, key)),
    toggleTask: (key: string) => setExpandedTasks((s) => toggled(s, key)),
  };
}

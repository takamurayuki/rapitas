/**
 * useNoteHoverSidebarExpansion
 *
 * Owns the expanded-category/theme/task Sets for NoteHoverSidebar's note
 * tree: auto-expands everything while searching, and expands the path to
 * whichever note is currently active. Extracted from the component to keep
 * it under the size limit; behavior is unchanged.
 */
'use client';
import { useEffect, useState } from 'react';
import type { Note } from '@/stores/note-store';
import type { NoteTree } from './note-tree-utils';
import { parseNotePath, parseNotePathThemeOnly } from './note-tree-utils';

export interface UseNoteHoverSidebarExpansionArgs {
  tree: NoteTree;
  searchQuery: string;
  notes: Note[];
  currentNoteId: string | null;
}

export interface UseNoteHoverSidebarExpansionReturn {
  expandedCategories: Set<string>;
  expandedThemes: Set<string>;
  expandedTasks: Set<string>;
  toggleCategory: (key: string) => void;
  toggleTheme: (key: string) => void;
  toggleTask: (key: string) => void;
}

function toggleKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Tracks which category/theme/task nodes of the note tree are expanded,
 * auto-expanding on search and to reveal the active note.
 *
 * @param args - the built note tree plus the state needed to auto-expand / 構築済みノートツリーと自動展開に必要な状態
 * @returns the expanded-node Sets and their toggle functions / 展開中ノードの集合とトグル関数
 */
export function useNoteHoverSidebarExpansion({
  tree,
  searchQuery,
  notes,
  currentNoteId,
}: UseNoteHoverSidebarExpansionArgs): UseNoteHoverSidebarExpansionReturn {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Auto-expand all when searching
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

  // Expand the path of the active note
  useEffect(() => {
    if (!currentNoteId) return;
    const activeNote = notes.find((n) => n.id === currentNoteId);
    if (!activeNote) return;

    // Primary: use stored metadata
    if (activeNote.linkedTaskIds?.length && activeNote.linkedTaskMeta) {
      for (const taskId of activeNote.linkedTaskIds) {
        const meta = activeNote.linkedTaskMeta[taskId];
        if (!meta) continue;
        if (meta.categoryName && meta.themeName) {
          const themeKey = `${meta.categoryName}|||${meta.themeName}`;
          const taskKey = `${themeKey}|||${taskId}`;
          setExpandedCategories((s) => new Set([...s, meta.categoryName]));
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

    // Fallback: title parsing (3-level then 2-level)
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
    toggleCategory: (key: string) => setExpandedCategories((s) => toggleKey(s, key)),
    toggleTheme: (key: string) => setExpandedThemes((s) => toggleKey(s, key)),
    toggleTask: (key: string) => setExpandedTasks((s) => toggleKey(s, key)),
  };
}

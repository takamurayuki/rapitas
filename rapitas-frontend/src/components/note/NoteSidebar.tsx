'use client';
/**
 * NoteSidebar
 *
 * Left sidebar rendered inside the /notes page.
 * Displays notes in a collapsible tree: Category → Theme → Task → Notes.
 * Notes whose titles do not match the "A > B > [#N]_..." pattern are shown
 * in a flat "その他" section at the bottom.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Trash2,
  ChevronRight,
  Plus,
  Search,
  Folders,
  SwatchBook,
  NotebookPen,
} from 'lucide-react';
import { useNoteStore, type Note } from '@/stores/note-store';
import DeleteNoteModal from './DeleteNoteModal';
import { buildNoteTree, parseNotePath } from './note-tree-utils';

function NoteItem({
  note,
  isActive,
  onSelect,
  onDelete,
  indent = 0,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  indent?: number;
}) {
  return (
    <div
      onClick={onSelect}
      style={{ paddingLeft: `${8 + indent * 12}px` }}
      className={`group flex items-center gap-2 pr-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isActive
          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/50'
      }`}
    >
      <NotebookPen className="w-3.5 h-3.5 shrink-0 text-blue-400 dark:text-blue-500" />
      <span className="flex-1 text-xs truncate">
        {/* Strip the hierarchy prefix if present, show just the leaf note name */}
        {note.title.includes(' > ')
          ? (note.title.split(' > ').pop() ?? note.title)
          : note.title || '(無題)'}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 transition-opacity shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function NoteSidebar() {
  const {
    notes,
    currentNoteId,
    searchQuery,
    setSearchQuery,
    createNote,
    deleteNote,
    setCurrentNote,
  } = useNoteStore();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    noteId: string | null;
    noteTitle: string;
  }>({ isOpen: false, noteId: null, noteTitle: '' });

  const filtered = useMemo(() => {
    if (!searchQuery) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    );
  }, [notes, searchQuery]);

  const tree = useMemo(() => buildNoteTree(filtered), [filtered]);

  // Auto-expand everything when a search is active so results are visible.
  useEffect(() => {
    if (searchQuery) {
      setExpandedCategories(new Set(tree.categories.map((c) => c.category)));
      setExpandedThemes(
        new Set(tree.categories.flatMap((c) => c.themes.map((t) => `${c.category}|||${t.theme}`))),
      );
      setExpandedTasks(
        new Set(
          tree.categories.flatMap((c) =>
            c.themes.flatMap((t) =>
              t.tasks.map((tk) => `${c.category}|||${t.theme}|||${tk.taskId}`),
            ),
          ),
        ),
      );
    }
  }, [searchQuery, tree]);

  // Expand the category/theme/task of the currently selected note on mount.
  useEffect(() => {
    if (!currentNoteId) return;
    const activeNote = notes.find((n) => n.id === currentNoteId);
    if (!activeNote) return;
    const parsed = parseNotePath(activeNote.title);
    if (!parsed) return;
    const themeKey = `${parsed.category}|||${parsed.theme}`;
    const taskKey = `${parsed.category}|||${parsed.theme}|||${parsed.taskId}`;
    setExpandedCategories((s) => new Set([...s, parsed.category]));
    setExpandedThemes((s) => new Set([...s, themeKey]));
    setExpandedTasks((s) => new Set([...s, taskKey]));
  }, [currentNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFn(next);
  };

  const openDelete = (note: Note) => {
    setDeleteModalState({ isOpen: true, noteId: note.id, noteTitle: note.title });
  };
  const confirmDelete = () => {
    if (deleteModalState.noteId) deleteNote(deleteModalState.noteId);
    setDeleteModalState({ isOpen: false, noteId: null, noteTitle: '' });
  };

  useEffect(() => {
    if (notes.length === 0) createNote();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasLinked = tree.categories.length > 0;
  const hasSolo = tree.standalone.length > 0;

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-800/50">
      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ノートを検索..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400"
          />
        </div>
      </div>

      {/* New note button */}
      <div className="px-3 pb-2">
        <button
          onClick={() => createNote()}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新規ノート
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3 space-y-0.5">
        {!hasLinked && !hasSolo && (
          <div className="py-6 text-center">
            <FileText className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {searchQuery ? '検索結果なし' : 'ノートがありません'}
            </p>
          </div>
        )}

        {/* Linked notes — Category > Theme > Task hierarchy */}
        {tree.categories.map((cat) => {
          const catExpanded = expandedCategories.has(cat.category);
          return (
            <div key={cat.category}>
              {/* Category row */}
              <button
                onClick={() => toggle(expandedCategories, setExpandedCategories, cat.category)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-md transition-colors"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 shrink-0 text-zinc-400 transition-transform ${catExpanded ? 'rotate-90' : ''}`}
                />
                <Folders className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                <span className="truncate">{cat.category}</span>
              </button>

              {catExpanded &&
                cat.themes.map((th) => {
                  const themeKey = `${cat.category}|||${th.theme}`;
                  const thExpanded = expandedThemes.has(themeKey);
                  return (
                    <div key={th.theme} className="ml-3">
                      {/* Theme row */}
                      <button
                        onClick={() => toggle(expandedThemes, setExpandedThemes, themeKey)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-md transition-colors"
                      >
                        <ChevronRight
                          className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${thExpanded ? 'rotate-90' : ''}`}
                        />
                        <SwatchBook className="w-3 h-3 shrink-0 text-purple-400" />
                        <span className="truncate">{th.theme}</span>
                      </button>

                      {thExpanded &&
                        th.tasks.map((tk) => {
                          const taskKey = `${cat.category}|||${th.theme}|||${tk.taskId}`;
                          const tkExpanded = expandedTasks.has(taskKey);
                          return (
                            <div key={tk.taskId} className="ml-3">
                              {/* Task row */}
                              <button
                                onClick={() => toggle(expandedTasks, setExpandedTasks, taskKey)}
                                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-md transition-colors"
                              >
                                <ChevronRight
                                  className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${tkExpanded ? 'rotate-90' : ''}`}
                                />
                                <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">
                                  {tk.taskLabel}
                                </span>
                              </button>

                              {tkExpanded &&
                                tk.notes.map((note) => (
                                  <div key={note.id} className="ml-3">
                                    <NoteItem
                                      note={note}
                                      isActive={note.id === currentNoteId}
                                      onSelect={() => setCurrentNote(note.id)}
                                      onDelete={() => openDelete(note)}
                                    />
                                  </div>
                                ))}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
            </div>
          );
        })}

        {/* Standalone notes */}
        {hasSolo && (
          <div>
            {hasLinked && (
              <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
                  その他
                </span>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
              </div>
            )}
            {tree.standalone.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                isActive={note.id === currentNoteId}
                onSelect={() => setCurrentNote(note.id)}
                onDelete={() => openDelete(note)}
              />
            ))}
          </div>
        )}
      </div>

      <DeleteNoteModal
        isOpen={deleteModalState.isOpen}
        noteTitle={deleteModalState.noteTitle}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteModalState({ isOpen: false, noteId: null, noteTitle: '' })}
      />
    </div>
  );
}

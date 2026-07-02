'use client';
/**
 * NoteSidebar
 *
 * Left sidebar rendered inside the /notes page.
 * Displays notes in a collapsible tree:
 *   3-level: Category → Theme → Task → Notes
 *   2-level: Theme → Task → Notes  (tasks without a category)
 *   Flat:    "その他" section for unlinked notes
 */
import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
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
import { useNoteStore, type Note, DOC_TYPES, type DocType } from '@/stores/note-store';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { getIconComponent } from '@/components/category/icon-data';
import DeleteNoteModal from './DeleteNoteModal';
import { buildNoteTree, parseNotePath, parseNotePathThemeOnly } from './note-tree-utils';

/** Maps each raw DocType value to its `docTypes.*` i18n message key. */
const DOC_TYPE_LABEL_KEYS: Record<DocType, string> = {
  要件定義: 'requirements',
  設計書: 'design',
  議事録: 'minutes',
  手順書: 'procedure',
  仕様書: 'specification',
  メモ: 'memo',
};

function NoteItem({
  note,
  isActive,
  onSelect,
  onDelete,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('notes');
  const displayTitle = note.title.includes(' > ')
    ? (note.title.split(' > ').pop() ?? note.title)
    : note.title || t('common.untitled');

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 pl-10 pr-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isActive
          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/50'
      }`}
    >
      <NotebookPen className="w-3.5 h-3.5 shrink-0 text-indigo-400 dark:text-indigo-500" />
      <span className="flex-1 text-xs truncate">{displayTitle}</span>
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
  const t = useTranslations('notes');
  const tc = useTranslations('common');
  const {
    notes,
    currentNoteId,
    searchQuery,
    selectedDocType,
    setSearchQuery,
    setSelectedDocType,
    createNote,
    deleteNote,
    setCurrentNote,
  } = useNoteStore();

  const filterCategories = useFilterDataStore((s) => s.categories);
  const filterThemes = useFilterDataStore((s) => s.themes);

  // Maps from display name → icon component for categories and themes.
  const categoryIconMap = useMemo(() => {
    const m = new Map<string, string | null | undefined>();
    filterCategories.forEach((c) => m.set(c.name, c.icon));
    return m;
  }, [filterCategories]);
  const themeIconMap = useMemo(() => {
    const m = new Map<string, string | null | undefined>();
    filterThemes.forEach((t) => m.set(t.name, t.icon));
    return m;
  }, [filterThemes]);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    noteId: string | null;
    noteTitle: string;
  }>({ isOpen: false, noteId: null, noteTitle: '' });

  const filtered = useMemo(() => {
    let result = notes;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
      );
    }
    if (selectedDocType) {
      result = result.filter((n) => n.docType === selectedDocType);
    }
    return result;
  }, [notes, searchQuery, selectedDocType]);

  const tree = useMemo(() => buildNoteTree(filtered), [filtered]);

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

  const hasLinked = tree.categories.length > 0 || tree.themeGroups.length > 0;
  const hasSolo = tree.standalone.length > 0;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('common.searchPlaceholder')}
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
          {t('common.newNote')}
        </button>
      </div>

      {/* DocType filter */}
      <div className="px-3 pb-2 flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedDocType(null)}
          className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
            !selectedDocType
              ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-medium'
              : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600'
          }`}
        >
          {tc('all')}
        </button>
        {DOC_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setSelectedDocType(selectedDocType === type ? null : (type as DocType))}
            className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
              selectedDocType === type
                ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-medium'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            {t(`docTypes.${DOC_TYPE_LABEL_KEYS[type]}`)}
          </button>
        ))}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3 space-y-0.5">
        {!hasLinked && !hasSolo && (
          <div className="py-6 text-center">
            <FileText className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {searchQuery ? t('sidebar.noSearchResults') : t('common.noNotes')}
            </p>
          </div>
        )}

        {/* 3-level: Category → Theme → Task → Notes */}
        {tree.categories.map((cat) => {
          const catExpanded = expandedCategories.has(cat.category);
          const CatIcon = getIconComponent(categoryIconMap.get(cat.category) ?? '') ?? Folders;
          return (
            <div key={cat.category}>
              <button
                onClick={() => toggle(expandedCategories, setExpandedCategories, cat.category)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-md transition-colors"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 shrink-0 text-zinc-400 transition-transform ${catExpanded ? 'rotate-90' : ''}`}
                />
                <CatIcon className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                <span className="truncate">{cat.category}</span>
              </button>

              {catExpanded &&
                cat.themes.map((th) => {
                  const themeKey = `${cat.category}|||${th.theme}`;
                  const thExpanded = expandedThemes.has(themeKey);
                  const ThIcon = getIconComponent(themeIconMap.get(th.theme) ?? '') ?? SwatchBook;
                  return (
                    <div key={th.theme} className="ml-3">
                      <button
                        onClick={() => toggle(expandedThemes, setExpandedThemes, themeKey)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-md transition-colors"
                      >
                        <ChevronRight
                          className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${thExpanded ? 'rotate-90' : ''}`}
                        />
                        <ThIcon className="w-3 h-3 shrink-0 text-purple-400" />
                        <span className="truncate">{th.theme}</span>
                      </button>

                      {thExpanded &&
                        th.tasks.map((tk) => {
                          const taskKey = `${themeKey}|||${tk.taskId}`;
                          const tkExpanded = expandedTasks.has(taskKey);
                          return (
                            <div key={tk.taskId} className="ml-3">
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
                                  <NoteItem
                                    key={note.id}
                                    note={note}
                                    isActive={note.id === currentNoteId}
                                    onSelect={() => setCurrentNote(note.id)}
                                    onDelete={() => openDelete(note)}
                                  />
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

        {/* 2-level: Theme → Task → Notes (no category) */}
        {tree.themeGroups.map((tg) => {
          const themeKey = `theme:${tg.theme}`;
          const thExpanded = expandedThemes.has(themeKey);
          const TgIcon = getIconComponent(themeIconMap.get(tg.theme) ?? '') ?? SwatchBook;
          return (
            <div key={themeKey}>
              <button
                onClick={() => toggle(expandedThemes, setExpandedThemes, themeKey)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-md transition-colors"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 shrink-0 text-zinc-400 transition-transform ${thExpanded ? 'rotate-90' : ''}`}
                />
                <TgIcon className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                <span className="truncate">{tg.theme}</span>
              </button>

              {thExpanded &&
                tg.tasks.map((tk) => {
                  const taskKey = `${themeKey}|||${tk.taskId}`;
                  const tkExpanded = expandedTasks.has(taskKey);
                  return (
                    <div key={tk.taskId} className="ml-3">
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
                          <NoteItem
                            key={note.id}
                            note={note}
                            isActive={note.id === currentNoteId}
                            onSelect={() => setCurrentNote(note.id)}
                            onDelete={() => openDelete(note)}
                          />
                        ))}
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
                  {tc('other')}
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

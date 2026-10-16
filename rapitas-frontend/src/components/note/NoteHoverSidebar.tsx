'use client';
/**
 * NoteHoverSidebar
 *
 * Hover-expandable left sidebar accessible from any page (note mode only).
 * Displays notes in a collapsible Category → Theme → Task → Notes tree.
 * Notes not matching the hierarchy pattern appear under "その他".
 */
import { useRef, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { NotebookTabs, ChevronRight, Plus, Search, Hash } from 'lucide-react';
import { useNoteStore, type Note } from '@/stores/note-store';
import { useUIModeStore } from '@/stores/ui-mode-store';
import { useFilterDataStore } from '@/stores/filter-data-store';
import DeleteNoteModal from './DeleteNoteModal';
import { formatDate as formatDateStandard } from '@/utils/date';
import { buildNoteTree } from './note-tree-utils';
import { useNoteHoverSidebarHover } from './useNoteHoverSidebarHover';
import { useNoteHoverSidebarExpansion } from './useNoteHoverSidebarExpansion';
import NoteHoverSidebarTree from './NoteHoverSidebarTree';

export default function NoteHoverSidebar() {
  const t = useTranslations('notes');
  const tc = useTranslations('common');
  const {
    currentNoteId,
    notes,
    searchQuery,
    selectedTags,
    getAllTags,
    createNote,
    deleteNote,
    setCurrentNote,
    setSearchQuery,
    toggleTag,
    clearFilters,
  } = useNoteStore();
  const { currentMode } = useUIModeStore();

  const filterCategories = useFilterDataStore((s) => s.categories);
  const filterThemes = useFilterDataStore((s) => s.themes);
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

  const { isExpanded, isHovered, handleMouseEnter, handleMouseLeave } = useNoteHoverSidebarHover();
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    noteId: string | null;
    noteTitle: string;
  }>({ isOpen: false, noteId: null, noteTitle: '' });

  const sidebarRef = useRef<HTMLDivElement>(null);

  const allTags = getAllTags();

  const filtered = useMemo(() => {
    let list = [...notes];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
      );
    }
    if (selectedTags.length > 0) {
      list = list.filter((n) => selectedTags.every((t) => n.tags?.includes(t)));
    }
    return list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [notes, searchQuery, selectedTags]);

  const tree = useMemo(() => buildNoteTree(filtered), [filtered]);

  const {
    expandedCategories,
    expandedThemes,
    expandedTasks,
    toggleCategory,
    toggleTheme,
    toggleTask,
  } = useNoteHoverSidebarExpansion({ tree, searchQuery, notes, currentNoteId });

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.ceil(Math.abs(now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return tc('today');
    if (diffDays === 1) return t('hoverSidebar.yesterday');
    if (diffDays < 7) return t('hoverSidebar.daysAgo', { days: diffDays });
    return formatDateStandard(d);
  };

  if (currentMode !== 'note') return null;

  const isEmpty =
    tree.categories.length === 0 && tree.themeGroups.length === 0 && tree.standalone.length === 0;

  return (
    <div
      ref={sidebarRef}
      className={`fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 transition-all duration-300 ${
        isExpanded ? 'w-80' : 'w-12'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Collapsed tab strip */}
      <div
        className={`absolute top-20 left-0 h-32 w-12 bg-linear-to-b from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 rounded-r-xl flex items-center justify-center cursor-pointer transition-all duration-300 ${
          isHovered ? 'scale-105' : ''
        } shadow-lg`}
      >
        <div className="flex flex-col items-center gap-2 text-white">
          <NotebookTabs className="w-5 h-5" />
          <ChevronRight
            className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Expanded panel */}
      <div
        className={`h-full bg-white dark:bg-zinc-900 shadow-2xl transition-all duration-300 ${
          isExpanded ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <NotebookTabs className="w-5 h-5 text-indigo-500" />
              <h3 className="font-semibold text-lg">{t('common.note')}</h3>
            </div>
            {/* Search at top */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('common.searchPlaceholder')}
                  aria-label={t('common.searchPlaceholder')}
                  className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
              <button
                onClick={() => createNote()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('common.newNote')}
              </button>
            </div>
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex flex-wrap gap-1">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
                      selectedTags.includes(tag)
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    <Hash className="w-3 h-3" />
                    {tag}
                  </button>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {t('hoverSidebar.clearFilters')}
                </button>
              )}
            </div>
          )}

          {/* Note tree */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            <NoteHoverSidebarTree
              tree={tree}
              isEmpty={isEmpty}
              searchQuery={searchQuery}
              selectedTagsCount={selectedTags.length}
              expandedCategories={expandedCategories}
              expandedThemes={expandedThemes}
              expandedTasks={expandedTasks}
              toggleCategory={toggleCategory}
              toggleTheme={toggleTheme}
              toggleTask={toggleTask}
              categoryIconMap={categoryIconMap}
              themeIconMap={themeIconMap}
              currentNoteId={currentNoteId}
              onSelectNote={setCurrentNote}
              onDeleteRequest={(note: Note) =>
                setDeleteModalState({ isOpen: true, noteId: note.id, noteTitle: note.title })
              }
              formatDate={formatDate}
              t={t}
              tc={tc}
            />
          </div>
        </div>
      </div>

      <DeleteNoteModal
        isOpen={deleteModalState.isOpen}
        noteTitle={deleteModalState.noteTitle}
        onConfirm={() => {
          if (deleteModalState.noteId) deleteNote(deleteModalState.noteId);
          setDeleteModalState({ isOpen: false, noteId: null, noteTitle: '' });
        }}
        onCancel={() => setDeleteModalState({ isOpen: false, noteId: null, noteTitle: '' })}
      />
    </div>
  );
}

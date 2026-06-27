'use client';
/**
 * NoteHoverSidebar
 *
 * Hover-expandable left sidebar accessible from any page (note mode only).
 * Displays notes in a collapsible Category → Theme → Task → Notes tree.
 * Notes not matching the hierarchy pattern appear under "その他".
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  NotebookTabs,
  ChevronRight,
  Plus,
  Search,
  Hash,
  Trash2,
  Calendar,
  FileText,
  Folders,
  SwatchBook,
  NotebookPen,
} from 'lucide-react';
import { useNoteStore, type Note } from '@/stores/note-store';
import { useUIModeStore } from '@/stores/ui-mode-store';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { getIconComponent } from '@/components/category/icon-data';
import DeleteNoteModal from './DeleteNoteModal';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { buildNoteTree, parseNotePath, parseNotePathThemeOnly } from './note-tree-utils';

export default function NoteHoverSidebar() {
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
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
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

  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    noteId: string | null;
    noteTitle: string;
  }>({ isOpen: false, noteId: null, noteTitle: '' });

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const sidebarRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFn(next);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(true), 300);
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(false), 300);
  };
  useEffect(
    () => () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    },
    [],
  );

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.ceil(Math.abs(now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return '今日';
    if (diffDays === 1) return '昨日';
    if (diffDays < 7) return `${diffDays}日前`;
    return d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  };

  if (currentMode !== 'note') return null;

  const hasLinked = tree.categories.length > 0 || tree.themeGroups.length > 0;
  const hasSolo = tree.standalone.length > 0;
  const isEmpty = !hasLinked && !hasSolo;

  const renderNote = (note: Note) => (
    <div
      key={note.id}
      onClick={() => setCurrentNote(note.id)}
      className={`group px-3 py-2 rounded-lg cursor-pointer transition-all ${
        currentNoteId === note.id
          ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-indigo-500'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <NotebookPen className="w-3 h-3 shrink-0 text-indigo-400" />
            <h4 className="font-medium text-xs truncate text-zinc-900 dark:text-zinc-100">
              {note.title.includes(' > ')
                ? (note.title.split(' > ').pop() ?? note.title)
                : note.title || '(無題)'}
            </h4>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
            {note.content.replace(/<[^>]*>/g, '') || '内容なし'}
          </p>
          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-400">
            <Calendar className="w-2.5 h-2.5" />
            {formatDate(note.updatedAt)}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDeleteModalState({ isOpen: true, noteId: note.id, noteTitle: note.title });
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-all shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

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
              <h3 className="font-semibold text-lg">ノート</h3>
            </div>
            {/* Search at top */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ノートを検索..."
                  className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
              <button
                onClick={() => createNote()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                新規ノート
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
                  フィルターをクリア
                </button>
              )}
            </div>
          )}

          {/* Note tree */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {isEmpty ? (
              <div className="py-6 text-center">
                <FileText className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {searchQuery || selectedTags.length > 0
                    ? '検索結果がありません'
                    : 'ノートがありません'}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {/* Linked notes hierarchy */}
                {tree.categories.map((cat) => {
                  const catExp = expandedCategories.has(cat.category);
                  const CatIcon =
                    getIconComponent(categoryIconMap.get(cat.category) ?? '') ?? Folders;
                  return (
                    <div key={cat.category}>
                      <button
                        onClick={() =>
                          toggle(expandedCategories, setExpandedCategories, cat.category)
                        }
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                      >
                        <ChevronRight
                          className={`w-4 h-4 shrink-0 text-zinc-400 transition-transform ${catExp ? 'rotate-90' : ''}`}
                        />
                        <CatIcon className="w-4 h-4 shrink-0 text-indigo-400" />
                        <span className="truncate">{cat.category}</span>
                      </button>

                      {catExp &&
                        cat.themes.map((th) => {
                          const thKey = `${cat.category}|||${th.theme}`;
                          const thExp = expandedThemes.has(thKey);
                          const ThIcon =
                            getIconComponent(themeIconMap.get(th.theme) ?? '') ?? SwatchBook;
                          return (
                            <div key={th.theme} className="ml-4">
                              <button
                                onClick={() => toggle(expandedThemes, setExpandedThemes, thKey)}
                                className="w-full flex items-center gap-2 px-2 py-1 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                              >
                                <ChevronRight
                                  className={`w-3.5 h-3.5 shrink-0 text-zinc-400 transition-transform ${thExp ? 'rotate-90' : ''}`}
                                />
                                <ThIcon className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                                <span className="truncate">{th.theme}</span>
                              </button>

                              {thExp &&
                                th.tasks.map((tk) => {
                                  const tkKey = `${thKey}|||${tk.taskId}`;
                                  const tkExp = expandedTasks.has(tkKey);
                                  return (
                                    <div key={tk.taskId} className="ml-4">
                                      <button
                                        onClick={() =>
                                          toggle(expandedTasks, setExpandedTasks, tkKey)
                                        }
                                        className="w-full flex items-center gap-2 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                                      >
                                        <ChevronRight
                                          className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${tkExp ? 'rotate-90' : ''}`}
                                        />
                                        <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">
                                          {tk.taskLabel}
                                        </span>
                                      </button>
                                      {tkExp && (
                                        <div className="ml-4 space-y-0.5">
                                          {tk.notes.map(renderNote)}
                                        </div>
                                      )}
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
                  const thExp = expandedThemes.has(themeKey);
                  const TgIcon = getIconComponent(themeIconMap.get(tg.theme) ?? '') ?? SwatchBook;
                  return (
                    <div key={themeKey}>
                      <button
                        onClick={() => toggle(expandedThemes, setExpandedThemes, themeKey)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                      >
                        <ChevronRight
                          className={`w-4 h-4 shrink-0 text-zinc-400 transition-transform ${thExp ? 'rotate-90' : ''}`}
                        />
                        <TgIcon className="w-4 h-4 shrink-0 text-purple-400" />
                        <span className="truncate">{tg.theme}</span>
                      </button>

                      {thExp &&
                        tg.tasks.map((tk) => {
                          const tkKey = `${themeKey}|||${tk.taskId}`;
                          const tkExp = expandedTasks.has(tkKey);
                          return (
                            <div key={tk.taskId} className="ml-4">
                              <button
                                onClick={() => toggle(expandedTasks, setExpandedTasks, tkKey)}
                                className="w-full flex items-center gap-2 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                              >
                                <ChevronRight
                                  className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${tkExp ? 'rotate-90' : ''}`}
                                />
                                <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">
                                  {tk.taskLabel}
                                </span>
                              </button>
                              {tkExp && (
                                <div className="ml-4 space-y-0.5">{tk.notes.map(renderNote)}</div>
                              )}
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
                        <span className="text-[10px] text-zinc-400 shrink-0">その他</span>
                        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                      </div>
                    )}
                    <div className="space-y-0.5">{tree.standalone.map(renderNote)}</div>
                  </div>
                )}
              </div>
            )}
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

'use client';
import { useState, useRef, useEffect } from 'react';
import {
  NotebookTabs,
  ChevronRight,
  Plus,
  Search,
  Hash,
  Pin,
  Trash2,
  Calendar,
  FileText,
} from 'lucide-react';
import { useNoteStore } from '@/stores/noteStore';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useUIModeStore } from '@/stores/uiModeStore';
import DeleteNoteModal from './DeleteNoteModal';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

export default function NoteHoverSidebar() {
  const {
    currentNoteId,
    searchQuery,
    selectedTags,
    getFilteredNotes,
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    noteId: string | null;
    noteTitle: string;
  }>({
    isOpen: false,
    noteId: null,
    noteTitle: '',
  });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const filteredNotes = getFilteredNotes();
  const allTags = getAllTags();

  // Hover handling
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setIsExpanded(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 300);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Only render in note mode
  if (currentMode !== 'note') return null;

  const handleDeleteNote = (id: string, title: string) => {
    setDeleteModalState({
      isOpen: true,
      noteId: id,
      noteTitle: title,
    });
  };

  const confirmDelete = () => {
    if (deleteModalState.noteId) {
      deleteNote(deleteModalState.noteId);
    }
    setDeleteModalState({ isOpen: false, noteId: null, noteTitle: '' });
  };

  const cancelDelete = () => {
    setDeleteModalState({ isOpen: false, noteId: null, noteTitle: '' });
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - d.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '今日';
    if (diffDays === 1) return '昨日';
    if (diffDays < 7) return `${diffDays}日前`;
    return d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  };

  return (
    <div
      ref={sidebarRef}
      className={`fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 transition-all duration-300 ${
        isExpanded ? 'w-80' : 'w-12'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Tab section */}
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

      {/* Sidebar body */}
      <div
        className={`h-full bg-white dark:bg-zinc-900 shadow-2xl transition-all duration-300 ${
          isExpanded
            ? 'translate-x-0 opacity-100'
            : '-translate-x-full opacity-0'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <NotebookTabs className="w-5 h-5 text-indigo-500" />
              <h3 className="font-semibold text-lg">ノート</h3>
            </div>

            {/* Search and create */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ノートを検索..."
                  className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600"
                />
              </div>
              <button
                onClick={createNote}
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
              <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                タグフィルター
              </h4>
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

          {/* Note list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {filteredNotes.length === 0 ? (
              <div className="p-4 text-center">
                <FileText className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {searchQuery || selectedTags.length > 0
                    ? '検索結果がありません'
                    : 'ノートがありません'}
                </p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredNotes.map((note) => (
                  <div
                    key={note.id}
                    onClick={() => setCurrentNote(note.id)}
                    className={`group p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                      currentNoteId === note.id
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-indigo-500'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-1">
                          {note.isPinned && (
                            <Pin className="w-3 h-3 text-yellow-500 shrink-0" />
                          )}
                          <h4 className="font-medium text-sm truncate text-zinc-900 dark:text-zinc-100">
                            {note.title}
                          </h4>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-1">
                          {note.content.replace(/<[^>]*>/g, '') || '内容なし'}
                        </p>
                        <div className="flex items-center gap-2">
                          {note.tags?.length > 0 && (
                            <div className="flex items-center gap-1">
                              {note.tags.slice(0, 2).map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded text-xs"
                                >
                                  <Hash className="w-2.5 h-2.5" />
                                  {tag}
                                </span>
                              ))}
                              {note.tags.length > 2 && (
                                <span className="text-xs text-zinc-400">
                                  +{note.tags.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-xs text-zinc-400">
                            <Calendar className="w-3 h-3" />
                            {formatDate(note.updatedAt)}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(note.id, note.title);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-all duration-200 shrink-0"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <DeleteNoteModal
        isOpen={deleteModalState.isOpen}
        noteTitle={deleteModalState.noteTitle}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

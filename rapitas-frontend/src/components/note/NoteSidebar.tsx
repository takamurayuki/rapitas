"use client";
import { useState } from "react";
import {
  Search,
  Plus,
  FileText,
  Pin,
  Trash2,
  Hash,
  Filter,
  ChevronDown,
  ChevronRight,
  Calendar
} from "lucide-react";
import { useNoteStore } from "@/stores/noteStore";
import { useDarkMode } from "@/hooks/use-dark-mode";

export default function NoteSidebar() {
  const {
    notes,
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

  const { isDarkMode } = useDarkMode();
  const [showTags, setShowTags] = useState(true);

  const filteredNotes = getFilteredNotes();
  const allTags = getAllTags();

  const handleDeleteNote = (id: string) => {
    if (confirm("このノートを削除しますか？")) {
      deleteNote(id);
    }
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - d.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "今日";
    if (diffDays === 1) return "昨日";
    if (diffDays < 7) return `${diffDays}日前`;
    return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-800/50 custom-scrollbar">
      {/* 検索・新規作成 */}
      <div className="p-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ノートを検索..."
            className="w-full pl-9 pr-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600"
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

      {/* タグフィルター */}
      {allTags.length > 0 && (
        <div className="px-3 pb-3">
          <button
            onClick={() => setShowTags(!showTags)}
            className="flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100 mb-2"
          >
            {showTags ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Filter className="w-3 h-3" />
            タグフィルター
          </button>
          {showTags && (
            <div className="space-y-1">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left transition-colors ${
                    selectedTags.includes(tag)
                      ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <Hash className="w-3 h-3" />
                  {tag}
                </button>
              ))}
              {selectedTags.length > 0 && (
                <button
                  onClick={clearFilters}
                  className="w-full px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  フィルターをクリア
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ノートリスト */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredNotes.length === 0 ? (
          <div className="p-4 text-center">
            <FileText className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {searchQuery || selectedTags.length > 0
                ? "検索結果がありません"
                : "ノートがありません"}
            </p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                onClick={() => setCurrentNote(note.id)}
                className={`group p-3 rounded-lg cursor-pointer transition-colors note-card-hover ${
                  currentNoteId === note.id
                    ? "bg-white dark:bg-zinc-900 shadow-sm"
                    : "hover:bg-white/50 dark:hover:bg-zinc-900/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      {note.isPinned && <Pin className="w-3 h-3 text-yellow-500" />}
                      <h4 className="font-medium text-sm truncate text-zinc-900 dark:text-zinc-100">
                        {note.title}
                      </h4>
                    </div>
                    <p
                      className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2"
                      dangerouslySetInnerHTML={{
                        __html: note.content.replace(/<[^>]*>/g, "") || "内容なし",
                      }}
                    />
                    {note.tags.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {note.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded text-xs"
                          >
                            <Hash className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                        {note.tags.length > 2 && (
                          <span className="text-xs text-zinc-400">+{note.tags.length - 2}</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-1 text-xs text-zinc-400">
                      <Calendar className="w-3 h-3" />
                      {formatDate(note.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteNote(note.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-opacity"
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
  );
}
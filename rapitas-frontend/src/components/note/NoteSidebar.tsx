'use client';
import { FileText, Pin, Trash2, Calendar } from 'lucide-react';
import { useNoteStore } from '@/stores/noteStore';
import { useState, useEffect } from 'react';
import DeleteNoteModal from './DeleteNoteModal';

export default function NoteSidebar() {
  const {
    currentNoteId,
    getFilteredNotes,
    createNote,
    deleteNote,
    setCurrentNote,
  } = useNoteStore();

  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    noteId: string | null;
    noteTitle: string;
  }>({
    isOpen: false,
    noteId: null,
    noteTitle: '',
  });

  const filteredNotes = getFilteredNotes();

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
    return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  // ノートリストが空の場合、初回のみ新規ノートを作成
  useEffect(() => {
    const notes = getFilteredNotes();
    if (notes.length === 0) {
      createNote();
    }
  }, []); // 初回マウント時のみ実行

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-800/50 custom-scrollbar">
      {/* ノートリスト */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pt-3">
        {filteredNotes.length === 0 ? (
          <div className="p-4 text-center">
            <FileText className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              ノートがありません
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
                    ? 'bg-white dark:bg-zinc-900 shadow-sm'
                    : 'hover:bg-white/50 dark:hover:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      {note.isPinned && (
                        <Pin className="w-3 h-3 text-yellow-500" />
                      )}
                      <h4 className="font-medium text-sm truncate text-zinc-900 dark:text-zinc-100">
                        {note.title}
                      </h4>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                      {note.content.replace(/<[^>]*>/g, '') || '内容なし'}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-xs text-zinc-400">
                      <Calendar className="w-3 h-3" />
                      {formatDate(note.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteNote(note.id, note.title);
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

      {/* 削除確認モーダル */}
      <DeleteNoteModal
        isOpen={deleteModalState.isOpen}
        noteTitle={deleteModalState.noteTitle}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import {
  X,
  Minus,
  Maximize2,
  Search,
  Plus,
  Trash2,
  Pin,
  Tag,
  Highlighter,
  Type,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Save,
  FileText,
  Calendar
} from "lucide-react";
import { useNoteStore } from "@/stores/noteStore";
import { useDarkMode } from "@/hooks/use-dark-mode";
import NoteEditor from "./NoteEditor";
import NoteSidebar from "./NoteSidebar";

export default function NoteModal() {
  const {
    modalState,
    notes,
    currentNoteId,
    closeModal,
    toggleMinimize,
    setModalPosition,
    setModalSize,
    bringToFront,
    createNote,
    updateNote,
    deleteNote,
    setCurrentNote,
  } = useNoteStore();

  const { isDarkMode } = useDarkMode();
  const modalRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const currentNote = notes.find((note) => note.id === currentNoteId);

  // ドラッグ処理
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("drag-handle")) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - modalState.position.x,
        y: e.clientY - modalState.position.y,
      });
      bringToFront();
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setModalPosition(e.clientX - dragStart.x, e.clientY - dragStart.y);
    }
    if (isResizing) {
      const newWidth = Math.max(400, resizeStart.width + e.clientX - resizeStart.x);
      const newHeight = Math.max(300, resizeStart.height + e.clientY - resizeStart.y);
      setModalSize(newWidth, newHeight);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
  };

  // リサイズハンドラー
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: modalState.size.width,
      height: modalState.size.height,
    });
    bringToFront();
  };

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, resizeStart]);

  // ショートカットキー
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeModal]);

  if (!modalState.isOpen) return null;

  return (
    <div
      ref={modalRef}
      className={`fixed bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-hidden transition-all duration-200 note-modal-enter ${
        modalState.isMinimized ? "h-12 note-modal-minimize" : ""
      } ${isDragging ? "cursor-move" : ""}`}
      style={{
        left: `${modalState.position.x}px`,
        top: `${modalState.position.y}px`,
        width: `${modalState.size.width}px`,
        height: modalState.isMinimized ? "48px" : `${modalState.size.height}px`,
        zIndex: modalState.zIndex,
        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* ヘッダー */}
      <div
        className="h-12 bg-gradient-to-r from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 flex items-center justify-between px-4 cursor-move drag-handle"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-white" />
          <h3 className="text-white font-medium select-none">
            {currentNote?.title || "ノート"}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMinimize}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors ripple-effect"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={closeModal}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors ripple-effect"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* コンテンツ */}
      {!modalState.isMinimized && (
        <div className="flex h-[calc(100%-48px)]">
          {/* サイドバー */}
          <div className="w-64 border-r border-zinc-200 dark:border-zinc-700">
            <NoteSidebar />
          </div>

          {/* エディター */}
          <div className="flex-1">
            {currentNote ? (
              <NoteEditor note={currentNote} />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <FileText className="w-16 h-16 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
                  <p className="text-zinc-500 dark:text-zinc-400 mb-4">
                    ノートを選択するか、新規作成してください
                  </p>
                  <button
                    onClick={createNote}
                    className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2 mx-auto"
                  >
                    <Plus className="w-4 h-4" />
                    新規ノート作成
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* リサイズハンドル */}
      {!modalState.isMinimized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute bottom-1 right-1 w-2 h-2 bg-zinc-400 dark:bg-zinc-600 rounded-sm" />
        </div>
      )}
    </div>
  );
}
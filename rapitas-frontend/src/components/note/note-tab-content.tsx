'use client';
// NoteTabContent
import { useRef, useState } from 'react';
import { FileText, Plus, PanelLeftOpen } from 'lucide-react';
import NoteEditor from './NoteEditor';
import NoteSidebar from './NoteSidebar';
import type { Note } from '@/stores/note-store';

interface NoteTabContentProps {
  /** The note currently open for editing, or undefined if none selected / 現在編集中のノート */
  currentNote: Note | undefined;
  /** Callback to create a new note / 新規ノート作成コールバック */
  onCreateNote: () => void;
}

/**
 * Renders the sidebar-plus-editor layout for the note tab.
 *
 * @param currentNote - Note to open in the editor, or undefined / エディタで開くノート
 * @param onCreateNote - Called when the user requests a new note / 新規ノート要求時に呼ばれる
 */
export default function NoteTabContent({ currentNote, onCreateNote }: NoteTabContentProps) {
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const sidebarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSidebarEnter = () => {
    if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
    sidebarTimerRef.current = setTimeout(() => setIsSidebarHovered(true), 150);
  };

  const handleSidebarLeave = () => {
    if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
    // NOTE: Slight delay prevents flicker when the cursor briefly exits the strip.
    sidebarTimerRef.current = setTimeout(() => setIsSidebarHovered(false), 200);
  };

  return (
    <div className="relative flex h-full">
      {/* Hover-expandable sidebar */}
      <div
        className="absolute left-0 top-0 h-full z-10"
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
      >
        {/* Thin trigger strip — always visible when sidebar is collapsed */}
        <div
          className={`h-full flex items-center transition-all duration-200 ${
            isSidebarHovered ? 'w-0 opacity-0' : 'w-6 opacity-100'
          }`}
        >
          <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer">
            <PanelLeftOpen className="w-3.5 h-3.5 text-zinc-400" />
          </div>
        </div>
        {/* Expandable sidebar panel */}
        <div
          className={`absolute left-0 top-0 h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700 shadow-xl transition-all duration-200 overflow-hidden ${
            isSidebarHovered ? 'w-64 opacity-100' : 'w-0 opacity-0'
          }`}
        >
          <div className="w-64 h-full">
            <NoteSidebar />
          </div>
        </div>
      </div>

      {/* Editor or empty state */}
      <div className="flex-1 pl-6">
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
                onClick={onCreateNote}
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
  );
}

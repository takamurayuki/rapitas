'use client';
/**
 * notes/page
 *
 * Full-page Notes + AI view. Replaces the floating NoteModal — same tab
 * structure (ノート / AI / 両方) but rendered as a standard Next.js page so
 * the user can navigate here via the sidebar instead of opening a dialog.
 */

import { useState } from 'react';
import { NotebookTabs, Sparkles, Columns2, ArrowLeftRight, NotebookPen } from 'lucide-react';
import { useNoteStore, type ModalTab, type SplitNoteSide } from '@/stores/note-store';
import NoteTabContent from '@/components/note/note-tab-content';
import AITabContent from '@/components/note/ai-tab-content';

const TABS: { id: ModalTab; label: string; icon: React.ElementType }[] = [
  { id: 'note', label: 'ノート', icon: NotebookTabs },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'split', label: '両方', icon: Columns2 },
];

export default function NotesPage() {
  const { notes, currentNoteId, createNote } = useNoteStore();

  const [activeTab, setActiveTab] = useState<ModalTab>('note');
  const [splitNoteSide, setSplitNoteSide] = useState<SplitNoteSide>('right');

  const currentNote = notes.find((n) => n.id === currentNoteId);

  const handleTabChange = (tab: ModalTab) => {
    setActiveTab(tab);
    if ((tab === 'note' || tab === 'split') && notes.length === 0) {
      createNote();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Page header — white, distinguished from the app header by a stronger border */}
      <div className="flex items-center justify-between px-5 py-3 bg-white dark:bg-zinc-900 border-b-2 border-zinc-200 dark:border-zinc-700 shrink-0">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <NotebookPen className="w-5 h-5 text-indigo-500 shrink-0" />
          <h1 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">ノート</h1>
        </div>

        {/* Right: swap button (split only) + segmented tab control */}
        <div className="flex items-center gap-2">
          {activeTab === 'split' && (
            <button
              onClick={() => setSplitNoteSide((s) => (s === 'right' ? 'left' : 'right'))}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title={
                splitNoteSide === 'right'
                  ? 'ノートを左に移動（AIを右に）'
                  : 'ノートを右に移動（AIを左に）'
              }
              aria-label="左右を入れ替える"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>
          )}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => handleTabChange(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === id
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'note' ? (
          <NoteTabContent currentNote={currentNote} onCreateNote={createNote} />
        ) : activeTab === 'ai' ? (
          <AITabContent />
        ) : (
          <div className="flex h-full w-full">
            {splitNoteSide === 'right' ? (
              <>
                <div className="flex-1 min-w-0 border-r border-zinc-200 dark:border-zinc-700">
                  <AITabContent />
                </div>
                <div className="flex-1 min-w-0">
                  <NoteTabContent currentNote={currentNote} onCreateNote={createNote} />
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 min-w-0 border-r border-zinc-200 dark:border-zinc-700">
                  <NoteTabContent currentNote={currentNote} onCreateNote={createNote} />
                </div>
                <div className="flex-1 min-w-0">
                  <AITabContent />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

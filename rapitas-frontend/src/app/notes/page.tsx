'use client';
/**
 * notes/page
 *
 * Full-page Notes + AI view. Replaces the floating NoteModal — same tab
 * structure (ノート / AI / 両方) but rendered as a standard Next.js page so
 * the user can navigate here via the sidebar instead of opening a dialog.
 */

import { useState } from 'react';
import { NotebookTabs, Sparkles, Columns2, Search, ArrowLeftRight } from 'lucide-react';
import { useNoteStore, type ModalTab, type SplitNoteSide } from '@/stores/note-store';
import NoteTabContent from '@/components/note/note-tab-content';
import AITabContent from '@/components/note/ai-tab-content';

export default function NotesPage() {
  const { notes, currentNoteId, searchQuery, createNote, setSearchQuery } = useNoteStore();

  const [activeTab, setActiveTab] = useState<ModalTab>('note');
  const [splitNoteSide, setSplitNoteSide] = useState<SplitNoteSide>('right');

  const currentNote = notes.find((n) => n.id === currentNoteId);

  const handleTabChange = (tab: ModalTab) => {
    setActiveTab(tab);
    if ((tab === 'note' || tab === 'split') && notes.length === 0) {
      createNote();
    }
  };

  const showSearch = activeTab === 'note' || activeTab === 'split';

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Page header — tab switcher + search */}
      <div className="flex items-center gap-3 px-4 py-2 bg-linear-to-r from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 select-none shrink-0">
        {/* Tab switcher */}
        <div
          className="flex items-center bg-white/15 rounded-md p-0.5"
          role="tablist"
          aria-label="ノートページ"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'note'}
            onClick={() => handleTabChange('note')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              activeTab === 'note'
                ? 'bg-white/25 text-white shadow-sm'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <NotebookTabs className="w-3.5 h-3.5" aria-hidden="true" />
            <span>ノート</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'ai'}
            onClick={() => handleTabChange('ai')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              activeTab === 'ai'
                ? 'bg-white/25 text-white shadow-sm'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>AI</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'split'}
            onClick={() => handleTabChange('split')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              activeTab === 'split'
                ? 'bg-white/25 text-white shadow-sm'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>両方</span>
          </button>
        </div>

        {/* Search — visible for note and split tabs */}
        {showSearch && (
          <div className="relative flex-1 max-w-xs">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ノートを検索..."
              aria-label="ノートを検索"
              className="w-full pl-7 pr-2 py-1 bg-white/15 hover:bg-white/20 focus:bg-white/25 text-white placeholder:text-white/50 text-sm rounded-lg border border-white/10 focus:border-white/30 focus:outline-none transition-all"
            />
          </div>
        )}

        {/* Swap sides button — split tab only */}
        {activeTab === 'split' && (
          <button
            onClick={() => setSplitNoteSide((s) => (s === 'right' ? 'left' : 'right'))}
            className="ml-auto p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
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

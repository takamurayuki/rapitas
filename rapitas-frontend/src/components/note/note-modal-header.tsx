'use client';
// NoteModalHeader
import {
  NotebookTabs,
  Sparkles,
  Search,
  Maximize2,
  Minimize2,
  X,
  Columns2,
  ArrowLeftRight,
} from 'lucide-react';
import type { ModalTab, SplitNoteSide } from '@/stores/note-store';

interface NoteModalHeaderProps {
  activeTab: ModalTab;
  isMaximized: boolean;
  searchQuery: string;
  /** Whether a drag gesture is currently in progress / ドラッグ中かどうか */
  didDragRef: React.RefObject<boolean>;
  splitNoteSide: SplitNoteSide;
  onDragStart: (e: React.MouseEvent) => void;
  onTabChange: (tab: ModalTab) => void;
  onSearchChange: (query: string) => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  onSwapSplit: () => void;
}

/**
 * Header bar with tab selector, search field, and window controls.
 *
 * @param activeTab - Currently selected tab / 現在選択中のタブ
 * @param isMaximized - Whether the modal is in maximized state / 最大化状態かどうか
 * @param searchQuery - Current note search string / ノート検索文字列
 * @param didDragRef - Ref tracking whether a drag gesture occurred / ドラッグ発生フラグのref
 * @param onDragStart - mousedown handler to initiate drag / ドラッグ開始ハンドラ
 * @param onTabChange - Callback when user switches tabs / タブ切替コールバック
 * @param onSearchChange - Callback when search input changes / 検索入力変更コールバック
 * @param onToggleMaximize - Callback to toggle maximized state / 最大化トグルコールバック
 * @param onClose - Callback to close the modal / モーダルを閉じるコールバック
 */
export default function NoteModalHeader({
  activeTab,
  isMaximized,
  searchQuery,
  didDragRef,
  splitNoteSide,
  onDragStart,
  onTabChange,
  onSearchChange,
  onToggleMaximize,
  onClose,
  onSwapSplit,
}: NoteModalHeaderProps) {
  const handleTabClick = (tab: ModalTab) => (e: React.MouseEvent) => {
    // NOTE: Suppress click when the mousedown was the start of a drag gesture.
    if (didDragRef.current) {
      e.preventDefault();
      return;
    }
    onTabChange(tab);
  };

  const handleMaximizeClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.preventDefault();
      return;
    }
    onToggleMaximize();
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.preventDefault();
      return;
    }
    onClose();
  };

  const handleSwapClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.preventDefault();
      return;
    }
    onSwapSplit();
  };

  return (
    <div
      className={`relative h-12 bg-linear-to-r from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 flex items-center justify-between px-3 select-none ${
        isMaximized ? 'cursor-default' : 'cursor-move'
      }`}
      onMouseDown={isMaximized ? undefined : onDragStart}
    >
      {/* Tab switcher */}
      <div
        className="relative flex items-center bg-white/15 rounded-md p-0.5"
        role="tablist"
        aria-label="ノートモーダル"
      >
        <span id="note-modal-title" className="sr-only">
          ノート
        </span>
        <button
          role="tab"
          aria-selected={activeTab === 'note'}
          aria-controls="note-tab-panel"
          onMouseDown={isMaximized ? undefined : onDragStart}
          onClick={handleTabClick('note')}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all select-none ${
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
          aria-controls="ai-tab-panel"
          onMouseDown={isMaximized ? undefined : onDragStart}
          onClick={handleTabClick('ai')}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all select-none ${
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
          aria-controls="split-tab-panel"
          onMouseDown={isMaximized ? undefined : onDragStart}
          onClick={handleTabClick('split')}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all select-none ${
            activeTab === 'split'
              ? 'bg-white/25 text-white shadow-sm'
              : 'text-white/60 hover:text-white'
          }`}
        >
          <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>両方</span>
        </button>
      </div>

      {/* Center search bar (note tab + split shows search; AI alone hides it) */}
      {(activeTab === 'note' || activeTab === 'split') && (
        <div className="relative flex-1 flex items-center justify-center px-4">
          <div className="relative w-full max-w-xs">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="ノートを検索..."
              aria-label="ノートを検索"
              className="w-full pl-7 pr-2 py-1 bg-white/15 hover:bg-white/20 focus:bg-white/25 text-white placeholder:text-white/50 text-sm rounded-lg border border-white/10 focus:border-white/30 focus:outline-none transition-all"
            />
          </div>
        </div>
      )}

      {/* Spacer for AI tab (keeps window controls right-aligned) */}
      {activeTab === 'ai' && <div className="relative flex-1" />}

      {/* Window controls */}
      <div className="relative flex items-center gap-1">
        {activeTab === 'split' && (
          <button
            onMouseDown={isMaximized ? undefined : onDragStart}
            onClick={handleSwapClick}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
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
        <button
          onMouseDown={isMaximized ? undefined : onDragStart}
          onClick={handleMaximizeClick}
          className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title={isMaximized ? '元のサイズに戻す' : '全画面表示'}
        >
          {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button
          onMouseDown={isMaximized ? undefined : onDragStart}
          onClick={handleCloseClick}
          className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

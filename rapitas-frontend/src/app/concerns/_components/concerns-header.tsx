/**
 * ConcernsHeader
 *
 * Page header for the 懸念バックログ: the Bug icon, title/subtitle, and the
 * "add concern" toggle button. Pure presentational — all state lives in
 * useConcerns.
 */
'use client';
import { Bug, Plus } from 'lucide-react';

interface ConcernsHeaderProps {
  /** Toggle the add-concern modal. */
  onAddClick: () => void;
}

/**
 * Render the Concern Backlog page header.
 *
 * @param props - The add-button click handler from useConcerns. / useConcerns の追加ボタンハンドラ。
 */
export function ConcernsHeader({ onAddClick }: ConcernsHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Bug className="h-5 w-5 text-rose-500" />
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">懸念</h1>
        <span className="text-xs text-zinc-400">スコープ外の懸念を起票・タスク化</span>
      </div>
      <button
        onClick={onAddClick}
        className="flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
      >
        <Plus className="h-3.5 w-3.5" />
        懸念を追加
      </button>
    </div>
  );
}

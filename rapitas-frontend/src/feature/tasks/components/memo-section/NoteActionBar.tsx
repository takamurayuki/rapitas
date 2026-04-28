'use client';
// NoteActionBar

import { Loader2, Pin, PinOff, Brain, Pencil, Trash2, CornerDownRight } from 'lucide-react';
import type { NoteData } from './types';

type NoteActionBarProps = {
  note: NoteData;
  isPinned: boolean;
  hasReplies: boolean;
  isAnalyzing: boolean;
  hasAnalysis: boolean;
  onTogglePin: () => void;
  onAnalyze: () => void;
  onReply: (n: NoteData) => void;
  onEdit: (n: NoteData) => void;
  onDelete: (id: number) => void;
};

/**
 * Renders the meta timestamp, reply count, and hover-visible action buttons for a note.
 *
 * @param note - The note whose actions are being rendered / 操作対象のメモ
 * @param isPinned - Whether the note is currently pinned / ピン留め状態
 * @param hasReplies - Whether the note has nested replies / 返信があるか
 * @param isAnalyzing - Whether AI analysis is currently running / AI分析実行中フラグ
 * @param hasAnalysis - Whether an analysis result already exists / 分析結果が存在するか
 * @param onTogglePin - Toggles pin state / ピン留め切り替えコールバック
 * @param onAnalyze - Triggers AI analysis / AI分析コールバック
 * @param onReply - Opens reply input / 返信入力を開くコールバック
 * @param onEdit - Enters edit mode / 編集モードに入るコールバック
 * @param onDelete - Deletes the note / 削除コールバック
 */
export function NoteActionBar({
  note,
  isPinned,
  hasReplies,
  isAnalyzing,
  hasAnalysis,
  onTogglePin,
  onAnalyze,
  onReply,
  onEdit,
  onDelete,
}: NoteActionBarProps) {
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-[10px] text-zinc-400">{note.time}</span>
      {hasReplies && (
        <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
          <CornerDownRight className="w-2.5 h-2.5" />
          {note.replies!.length}
        </span>
      )}
      <div className="flex-1" />
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onTogglePin}
          className={`p-1 transition-colors rounded ${
            isPinned
              ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/30'
              : 'text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
          }`}
          title={isPinned ? 'ピン留め解除' : 'ピン留め'}
        >
          {isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
        </button>
        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className={`p-1 transition-colors rounded ${
            hasAnalysis
              ? 'text-purple-500 bg-purple-50 dark:bg-purple-900/30'
              : 'text-zinc-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/30'
          } disabled:opacity-50`}
          title="AI分析"
        >
          {isAnalyzing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Brain className="w-3 h-3" />
          )}
        </button>
        <button
          onClick={() => onReply(note)}
          className="p-1 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
          title="返信"
        >
          <CornerDownRight className="w-3 h-3" />
        </button>
        <button
          onClick={() => onEdit(note)}
          className="p-1 text-zinc-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded transition-colors"
          title="編集"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={() => onDelete(note.id)}
          className="p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
          title="削除"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

'use client';
// NoteReplyInput

import { X } from 'lucide-react';

type NoteReplyInputProps = {
  replyText: string;
  onReplyText: (s: string) => void;
  onReplySubmit: () => void;
  onReplyCancel: () => void;
};

/**
 * Renders a single-line reply input with Send and Cancel controls.
 *
 * @param replyText - Current reply draft / 返信の下書きテキスト
 * @param onReplyText - Updates the draft / テキスト更新コールバック
 * @param onReplySubmit - Submits the reply / 送信コールバック
 * @param onReplyCancel - Cancels the reply / キャンセルコールバック
 */
export function NoteReplyInput({
  replyText,
  onReplyText,
  onReplySubmit,
  onReplyCancel,
}: NoteReplyInputProps) {
  return (
    <div className="flex gap-1.5 mt-2 p-1.5 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <input
        value={replyText}
        onChange={(e) => onReplyText(e.target.value)}
        placeholder="返信を入力..."
        className="flex-1 px-2 py-1 text-xs bg-transparent outline-none placeholder:text-zinc-400"
        autoFocus
        onKeyDown={(e) =>
          e.key === 'Enter' && (e.preventDefault(), onReplySubmit())
        }
      />
      <button
        onClick={onReplyCancel}
        className="p-1 text-zinc-400 hover:text-zinc-600"
      >
        <X className="w-3 h-3" />
      </button>
      <button
        onClick={onReplySubmit}
        disabled={!replyText.trim()}
        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-[10px] disabled:opacity-50 transition-colors"
      >
        送信
      </button>
    </div>
  );
}

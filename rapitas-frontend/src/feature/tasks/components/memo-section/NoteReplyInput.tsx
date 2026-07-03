'use client';
// NoteReplyInput

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('task.noteReplyInput');
  const tCommon = useTranslations('common');
  return (
    <div className="flex gap-1.5 mt-2 p-1.5 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <input
        value={replyText}
        onChange={(e) => onReplyText(e.target.value)}
        placeholder={t('placeholder')}
        className="flex-1 px-2 py-1 text-xs bg-transparent outline-none placeholder:text-zinc-500"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onReplySubmit())}
      />
      <button
        onClick={onReplyCancel}
        aria-label={tCommon('cancel')}
        className="p-1 text-zinc-500 hover:text-zinc-600"
      >
        <X className="w-3 h-3" />
      </button>
      <button
        onClick={onReplySubmit}
        disabled={!replyText.trim()}
        className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] disabled:opacity-50 transition-colors"
      >
        {t('send')}
      </button>
    </div>
  );
}

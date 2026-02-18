'use client';
import { AlertCircle } from 'lucide-react';

interface DeleteNoteModalProps {
  isOpen: boolean;
  noteTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteNoteModal({
  isOpen,
  noteTitle,
  onConfirm,
  onCancel,
}: DeleteNoteModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* オーバーレイ */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      {/* モーダルコンテンツ */}
      <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              ノートの削除
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              この操作は取り消せません
            </p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            「<span className="font-medium">{noteTitle}</span>」を削除しますか？
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            削除する
          </button>
        </div>
      </div>
    </div>
  );
}

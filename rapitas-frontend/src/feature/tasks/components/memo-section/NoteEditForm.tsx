'use client';
// NoteEditForm

type NoteEditFormProps = {
  editText: string;
  onEditText: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * Renders a textarea and Save/Cancel buttons for editing a memo note inline.
 *
 * @param editText - Current draft text / 編集中のテキスト
 * @param onEditText - Updates the draft / テキスト更新コールバック
 * @param onSave - Submits the edit / 保存コールバック
 * @param onCancel - Discards the edit / キャンセルコールバック
 */
export function NoteEditForm({
  editText,
  onEditText,
  onSave,
  onCancel,
}: NoteEditFormProps) {
  return (
    <div className="space-y-1.5">
      <textarea
        value={editText}
        onChange={(e) => onEditText(e.target.value)}
        className="w-full p-2 text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg resize-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
        rows={3}
        autoFocus
      />
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onCancel}
          className="px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded transition-colors"
        >
          キャンセル
        </button>
        <button
          onClick={onSave}
          disabled={!editText.trim()}
          className="px-2.5 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 transition-colors"
        >
          保存
        </button>
      </div>
    </div>
  );
}

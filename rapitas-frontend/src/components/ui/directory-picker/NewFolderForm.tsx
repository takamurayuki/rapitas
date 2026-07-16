'use client';

/**
 * directory-picker/NewFolderForm
 *
 * Inline form for creating a new folder inside the current browse path.
 * Extracted from DirectoryList to keep files within the size policy.
 * Not responsible for the creation API call — delegates via onConfirm.
 */

import { FolderPlus, Check, X, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

type NewFolderFormProps = {
  currentPath: string;
  newFolderName: string;
  isCreating: boolean;
  createError: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNameChange: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Inline form for creating a new folder inside the current path.
 *
 * @param currentPath - Path in which the folder will be created / フォルダ作成先パス
 * @param newFolderName - Controlled input value / フォルダ名入力値
 * @param isCreating - Whether the API call is in-flight / 作成中フラグ
 * @param createError - Validation or API error message / エラーメッセージ
 * @param inputRef - Ref forwarded to the text input for auto-focus / 入力要素のref
 * @param onNameChange - Called on every keystroke / 入力変更コールバック
 * @param onConfirm - Called to submit the creation / 確定コールバック
 * @param onCancel - Called to dismiss the form / キャンセルコールバック
 */
export function NewFolderForm({
  currentPath,
  newFolderName,
  isCreating,
  createError,
  inputRef,
  onNameChange,
  onConfirm,
  onCancel,
}: NewFolderFormProps) {
  const t = useTranslations('common');

  return (
    <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-green-50 dark:bg-green-900/10">
      <div className="flex items-center gap-2 mb-2">
        <FolderPlus className="w-4 h-4 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium text-green-700 dark:text-green-300">
          {t('directoryPicker.createFolderTitle')}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-500 font-mono ml-1">
          in {currentPath}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={newFolderName}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onConfirm();
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
          placeholder={t('directoryPicker.folderNamePlaceholder')}
          className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:border-indigo-400"
          disabled={isCreating}
        />
        <button
          onClick={onConfirm}
          disabled={!newFolderName.trim() || isCreating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          {t('create')}
        </button>
        <button
          onClick={onCancel}
          disabled={isCreating}
          aria-label={t('cancel')}
          className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {createError && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{createError}</p>
      )}
    </div>
  );
}

'use client';

/**
 * directory-picker/DirectoryList
 *
 * Renders the scrollable directory listing area including loading skeletons,
 * empty state, error state, and the new-folder creation form.
 * Not responsible for any data fetching or favorites logic.
 */

import { useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ChevronRight,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { SkeletonBlock } from '../LoadingSpinner';
import type { DirectoryEntry } from './types';

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
function NewFolderForm({
  currentPath,
  newFolderName,
  isCreating,
  createError,
  inputRef,
  onNameChange,
  onConfirm,
  onCancel,
}: NewFolderFormProps) {
  return (
    <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-green-50 dark:bg-green-900/10">
      <div className="flex items-center gap-2 mb-2">
        <FolderPlus className="w-4 h-4 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium text-green-700 dark:text-green-300">
          新規フォルダを作成
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono ml-1">
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
          placeholder="フォルダ名を入力..."
          className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
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
          作成
        </button>
        <button
          onClick={onCancel}
          disabled={isCreating}
          className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {createError && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {createError}
        </p>
      )}
    </div>
  );
}

type DirectoryListProps = {
  directories: DirectoryEntry[];
  isLoading: boolean;
  error: string | null;
  showFavorites: boolean;
  isCreatingFolder: boolean;
  currentPath: string;
  newFolderName: string;
  isCreating: boolean;
  createError: string | null;
  newFolderInputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (path: string) => void;
  onGoToDrives: () => void;
  onFolderNameChange: (name: string) => void;
  onCreateConfirm: () => void;
  onCreateCancel: () => void;
};

/**
 * Renders the full directory-listing area (skeleton, error, empty, or item list)
 * plus the optional new-folder creation form above it.
 *
 * @param directories - Directory entries to display / 表示するディレクトリ一覧
 * @param isLoading - Whether a browse request is in-flight / 読み込み中フラグ
 * @param error - Error message from the last browse request / エラーメッセージ
 * @param showFavorites - Whether the favorites sidebar is expanded / お気に入り表示フラグ
 * @param isCreatingFolder - Whether the new-folder form is visible / フォルダ作成フォーム表示フラグ
 * @param currentPath - Path currently shown in the browser / 現在のパス
 * @param newFolderName - Controlled value for the new-folder input / 新規フォルダ名
 * @param isCreating - Whether folder creation API call is in-flight / 作成中フラグ
 * @param createError - Validation or API error for folder creation / 作成エラーメッセージ
 * @param newFolderInputRef - Ref forwarded to the new-folder input / 入力要素のref
 * @param onNavigate - Called when the user clicks a directory / ディレクトリ選択コールバック
 * @param onGoToDrives - Called to navigate to drive list / ドライブ一覧移動コールバック
 * @param onFolderNameChange - Called on new-folder name input change / フォルダ名変更コールバック
 * @param onCreateConfirm - Called to confirm folder creation / 作成確定コールバック
 * @param onCreateCancel - Called to cancel folder creation / 作成キャンセルコールバック
 */
export function DirectoryList({
  directories,
  isLoading,
  error,
  showFavorites,
  isCreatingFolder,
  currentPath,
  newFolderName,
  isCreating,
  createError,
  newFolderInputRef,
  onNavigate,
  onGoToDrives,
  onFolderNameChange,
  onCreateConfirm,
  onCreateCancel,
}: DirectoryListProps) {
  return (
    <>
      {isCreatingFolder && (
        <NewFolderForm
          currentPath={currentPath}
          newFolderName={newFolderName}
          isCreating={isCreating}
          createError={createError}
          inputRef={newFolderInputRef}
          onNameChange={onFolderNameChange}
          onConfirm={onCreateConfirm}
          onCancel={onCreateCancel}
        />
      )}

      <div
        className={`overflow-y-auto ${showFavorites ? 'h-40' : 'h-72'}`}
      >
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <SkeletonBlock className="w-4 h-4 rounded" />
                <SkeletonBlock
                  className={`h-4 ${i % 2 === 0 ? 'w-32' : 'w-24'}`}
                />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500 dark:text-red-400 p-4">
            <p className="text-sm text-center">{error}</p>
            <button
              onClick={onGoToDrives}
              className="mt-4 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 underline"
            >
              ドライブ一覧に戻る
            </button>
          </div>
        ) : directories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
            <FolderOpen className="w-12 h-12 mb-2 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm">サブフォルダがありません</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {directories.map((dir) => {
              const isDrive = /^[A-Z]:\\?$/.test(dir.path);
              return (
                <button
                  key={dir.path}
                  onClick={() => onNavigate(dir.path)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                >
                  {isDrive ? (
                    <HardDrive className="w-5 h-5 text-blue-500 shrink-0" />
                  ) : (
                    <Folder className="w-5 h-5 text-amber-500 shrink-0" />
                  )}
                  <span className="flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {dir.name}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

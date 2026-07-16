'use client';

/**
 * directory-picker/DirectoryList
 *
 * Renders the scrollable directory listing area including loading skeletons,
 * empty state, error state, and the new-folder creation form. Rows support
 * single-click selection (highlight) and double-click / chevron navigation.
 * Not responsible for any data fetching or favorites logic.
 */

import { Folder, FolderOpen, HardDrive, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SkeletonBlock } from '../LoadingSpinner';
import type { DirectoryEntry } from './types';
import { NewFolderForm } from './NewFolderForm';

type DirectoryListProps = {
  directories: DirectoryEntry[];
  isLoading: boolean;
  error: string | null;
  showFavorites: boolean;
  isCreatingFolder: boolean;
  currentPath: string;
  filter: string;
  selectedPath: string | null;
  newFolderName: string;
  isCreating: boolean;
  createError: string | null;
  newFolderInputRef: React.RefObject<HTMLInputElement | null>;
  onSelectRow: (path: string) => void;
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
 * @param directories - Directory entries to display (already filtered) / 表示するディレクトリ一覧
 * @param isLoading - Whether a browse request is in-flight / 読み込み中フラグ
 * @param error - Error message from the last browse request / エラーメッセージ
 * @param showFavorites - Whether the favorites sidebar is expanded / お気に入り表示フラグ
 * @param isCreatingFolder - Whether the new-folder form is visible / フォルダ作成フォーム表示フラグ
 * @param currentPath - Path currently shown in the browser / 現在のパス
 * @param filter - Active type-ahead filter text (for the empty state) / 絞り込み文字列
 * @param selectedPath - Row currently highlighted as the selection candidate / 選択候補のパス
 * @param newFolderName - Controlled value for the new-folder input / 新規フォルダ名
 * @param isCreating - Whether folder creation API call is in-flight / 作成中フラグ
 * @param createError - Validation or API error for folder creation / 作成エラーメッセージ
 * @param newFolderInputRef - Ref forwarded to the new-folder input / 入力要素のref
 * @param onSelectRow - Called on single click to highlight a row / 行ハイライトコールバック
 * @param onNavigate - Called on double click / chevron click to enter a directory / ディレクトリ移動コールバック
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
  filter,
  selectedPath,
  newFolderName,
  isCreating,
  createError,
  newFolderInputRef,
  onSelectRow,
  onNavigate,
  onGoToDrives,
  onFolderNameChange,
  onCreateConfirm,
  onCreateCancel,
}: DirectoryListProps) {
  const t = useTranslations('common');

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

      <div className={`overflow-y-auto ${showFavorites ? 'h-40' : 'h-72'}`}>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <SkeletonBlock className="w-4 h-4 rounded" />
                <SkeletonBlock className={`h-4 ${i % 2 === 0 ? 'w-32' : 'w-24'}`} />
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
              {t('directoryPicker.backToDrives')}
            </button>
          </div>
        ) : directories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400 p-4">
            <FolderOpen className="w-12 h-12 mb-2 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-center">
              {filter
                ? t('directoryPicker.noFilterMatch', { filter })
                : t('directoryPicker.noSubfolders')}
            </p>
          </div>
        ) : (
          <div
            role="listbox"
            aria-label={t('directoryPicker.folderList')}
            className="divide-y divide-zinc-100 dark:divide-zinc-800"
          >
            {directories.map((dir) => {
              const isDrive = /^[A-Z]:\\?$/.test(dir.path);
              const isSelected = selectedPath === dir.path;
              return (
                <div
                  key={dir.path}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => onSelectRow(dir.path)}
                  onDoubleClick={() => onNavigate(dir.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onSelectRow(dir.path);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-inset ring-indigo-400 dark:ring-indigo-500'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  {isDrive ? (
                    <HardDrive className="w-5 h-5 text-indigo-500 shrink-0" />
                  ) : (
                    <Folder className="w-5 h-5 text-amber-500 shrink-0" />
                  )}
                  <span className="flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {dir.name}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      // NOTE: stopPropagation so entering a folder doesn't also mark it selected.
                      e.stopPropagation();
                      onNavigate(dir.path);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    aria-label={t('directoryPicker.openFolder')}
                    title={t('directoryPicker.openFolder')}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors shrink-0"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

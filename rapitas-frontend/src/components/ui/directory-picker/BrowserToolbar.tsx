'use client';

/**
 * directory-picker/BrowserToolbar
 *
 * Navigation and action toolbar rendered inside the browser modal.
 * Displays navigation buttons (up/drives), the current path breadcrumb,
 * and controls for new folder creation and favorites toggling.
 * Not responsible for any data fetching.
 */

import { FolderPlus, ArrowUp, Monitor, HardDrive, GitBranch, Star, StarOff } from 'lucide-react';
import type { FavoriteDirectory } from './types';

type BrowserToolbarProps = {
  currentPath: string;
  isGitRepo: boolean;
  isDriveList: boolean;
  isLoading: boolean;
  favorites: FavoriteDirectory[];
  showFavorites: boolean;
  isCreatingFolder: boolean;
  isFavorite: (path: string) => boolean;
  getFavoriteId: (path: string) => number | undefined;
  onGoUp: () => void;
  onGoToDrives: () => void;
  onStartCreateFolder: () => void;
  onToggleFavorites: () => void;
  onAddFavorite: (path: string) => void;
  onRemoveFavorite: (id: number) => void;
};

/**
 * Renders the toolbar row of the directory browser modal.
 *
 * @param currentPath - Path currently displayed in the browser / 現在表示中のパス
 * @param isGitRepo - Whether the current path is a Git repository / Gitリポジトリフラグ
 * @param isDriveList - Whether the browser is showing the drive list / ドライブ一覧表示フラグ
 * @param isLoading - Whether a browse request is in-flight / 読み込み中フラグ
 * @param favorites - Saved favorites list (for count display) / お気に入りリスト
 * @param showFavorites - Whether the favorites sidebar is expanded / お気に入り表示フラグ
 * @param isCreatingFolder - Whether the new-folder form is open / フォルダ作成フォーム表示フラグ
 * @param isFavorite - Returns true if the given path is a favorite / お気に入り判定関数
 * @param getFavoriteId - Returns the favorite id for the given path / お気に入りID取得関数
 * @param onGoUp - Navigate to the parent directory / 上のフォルダへ移動
 * @param onGoToDrives - Navigate to the drive list / ドライブ一覧へ移動
 * @param onStartCreateFolder - Open the new-folder creation form / フォルダ作成開始
 * @param onToggleFavorites - Toggle the favorites sidebar / お気に入りサイドバー切替
 * @param onAddFavorite - Add the current path to favorites / お気に入りに追加
 * @param onRemoveFavorite - Remove a favorite by id / お気に入りから削除
 */
export function BrowserToolbar({
  currentPath,
  isGitRepo,
  isDriveList,
  isLoading,
  favorites,
  showFavorites,
  isCreatingFolder,
  isFavorite,
  getFavoriteId,
  onGoUp,
  onGoToDrives,
  onStartCreateFolder,
  onToggleFavorites,
  onAddFavorite,
  onRemoveFavorite,
}: BrowserToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-1 border-r border-zinc-200 dark:border-zinc-700 pr-2 mr-1">
        <button
          onClick={onGoUp}
          disabled={isLoading}
          className="p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="上のフォルダへ"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          onClick={onGoToDrives}
          disabled={isLoading}
          className="p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
          title="ドライブ一覧"
        >
          <Monitor className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto min-w-0">
        <HardDrive className="w-4 h-4 text-zinc-400 shrink-0" />
        <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">
          {currentPath || 'ドライブ一覧'}
        </span>
        {isGitRepo && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs font-medium shrink-0">
            <GitBranch className="w-3 h-3" />
            Git
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 border-l border-zinc-200 dark:border-zinc-700 pl-2 ml-1">
        {currentPath && !isDriveList && (
          <button
            onClick={onStartCreateFolder}
            disabled={isCreatingFolder}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
            title="新規フォルダを作成"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">新規</span>
          </button>
        )}

        <button
          onClick={onToggleFavorites}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            showFavorites
              ? 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
          title={showFavorites ? 'お気に入りを非表示' : 'お気に入りを表示'}
        >
          <Star className={`w-3.5 h-3.5 ${showFavorites ? 'fill-current' : ''}`} />
          <span className="hidden sm:inline">{favorites.length}</span>
        </button>

        {currentPath && (
          <button
            onClick={() => {
              if (isFavorite(currentPath)) {
                const favId = getFavoriteId(currentPath);
                if (favId) onRemoveFavorite(favId);
              } else {
                onAddFavorite(currentPath);
              }
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isFavorite(currentPath)
                ? 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title={isFavorite(currentPath) ? 'お気に入りから削除' : 'お気に入りに追加'}
          >
            {isFavorite(currentPath) ? (
              <>
                <Star className="w-3.5 h-3.5 fill-current" />
                <span className="hidden sm:inline">登録済</span>
              </>
            ) : (
              <>
                <StarOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">追加</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

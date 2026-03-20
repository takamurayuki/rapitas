'use client';

/**
 * directory-picker/BrowserModal
 *
 * Full-screen overlay modal that wraps the directory browser. Renders the
 * modal chrome (header, path input bar, footer) and delegates the toolbar,
 * favorites panels, and directory list to dedicated sub-components.
 * Not responsible for data fetching — receives all state via props.
 */

import { Folder, X, Check } from 'lucide-react';
import type { FavoriteDirectory, DirectoryEntry } from './types';
import { BrowserToolbar } from './BrowserToolbar';
import { FavoritesOnlyPanel } from './FavoritesOnlyPanel';
import { FavoritesSidebar } from './FavoritesSidebar';
import { DirectoryList } from './DirectoryList';

type BrowserModalProps = {
  currentPath: string;
  directories: DirectoryEntry[];
  isGitRepo: boolean;
  isDriveList: boolean;
  isLoading: boolean;
  error: string | null;
  manualPath: string;
  onManualPathChange: (v: string) => void;
  onGoUp: () => void;
  onGoToDrives: () => void;
  onGoToPath: () => void;
  onNavigate: (path: string) => void;
  onSelect: () => void;
  onClose: () => void;
  favorites: FavoriteDirectory[];
  currentValue: string;
  showFavorites: boolean;
  onShowFavoritesChange: (v: boolean) => void;
  favoritesOnlyMode: boolean;
  onStartBrowsing: () => void;
  onSelectFavorite: (path: string) => void;
  onRemoveFavorite: (id: number) => void;
  onAddFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  getFavoriteId: (path: string) => number | undefined;
  isCreatingFolder: boolean;
  newFolderName: string;
  isCreating: boolean;
  createError: string | null;
  newFolderInputRef: React.RefObject<HTMLInputElement | null>;
  onStartCreateFolder: () => void;
  onFolderNameChange: (name: string) => void;
  onCreateConfirm: () => void;
  onCreateCancel: () => void;
};

/**
 * Renders the directory-picker modal overlay and all internal panels.
 *
 * @param props - All state and handler values from useDirectoryPicker / 全状態とハンドラ
 */
export function BrowserModal({
  currentPath,
  directories,
  isGitRepo,
  isDriveList,
  isLoading,
  error,
  manualPath,
  onManualPathChange,
  onGoUp,
  onGoToDrives,
  onGoToPath,
  onNavigate,
  onSelect,
  onClose,
  favorites,
  currentValue,
  showFavorites,
  onShowFavoritesChange,
  favoritesOnlyMode,
  onStartBrowsing,
  onSelectFavorite,
  onRemoveFavorite,
  onAddFavorite,
  isFavorite,
  getFavoriteId,
  isCreatingFolder,
  newFolderName,
  isCreating,
  createError,
  newFolderInputRef,
  onStartCreateFolder,
  onFolderNameChange,
  onCreateConfirm,
  onCreateCancel,
}: BrowserModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
          <div className="flex items-center gap-3">
            <Folder className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              ディレクトリを選択
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar — hidden in favorites-only mode */}
        {!favoritesOnlyMode && (
          <BrowserToolbar
            currentPath={currentPath}
            isGitRepo={isGitRepo}
            isDriveList={isDriveList}
            isLoading={isLoading}
            favorites={favorites}
            showFavorites={showFavorites}
            isCreatingFolder={isCreatingFolder}
            isFavorite={isFavorite}
            getFavoriteId={getFavoriteId}
            onGoUp={onGoUp}
            onGoToDrives={onGoToDrives}
            onStartCreateFolder={onStartCreateFolder}
            onToggleFavorites={() => onShowFavoritesChange(!showFavorites)}
            onAddFavorite={onAddFavorite}
            onRemoveFavorite={onRemoveFavorite}
          />
        )}

        {/* Manual path input — hidden in favorites-only mode */}
        {!favoritesOnlyMode && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => onManualPathChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onGoToPath();
              }}
              placeholder="パスを直接入力 (例: C:\Projects, D:\)"
              className="flex-1 px-3 py-1.5 text-sm font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
            />
            <button
              onClick={onGoToPath}
              disabled={!manualPath.trim() || isLoading}
              className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              移動
            </button>
          </div>
        )}

        {/* Main content */}
        {favoritesOnlyMode && favorites.length > 0 ? (
          <FavoritesOnlyPanel
            favorites={favorites}
            currentValue={currentValue}
            onSelect={(path) => {
              onSelectFavorite(path);
              onClose();
            }}
            onRemove={onRemoveFavorite}
            onStartBrowsing={onStartBrowsing}
          />
        ) : (
          <>
            {showFavorites && favorites.length > 0 && (
              <FavoritesSidebar
                favorites={favorites}
                currentValue={currentValue}
                onNavigate={onNavigate}
                onRemove={onRemoveFavorite}
                onHide={() => onShowFavoritesChange(false)}
              />
            )}
            <DirectoryList
              directories={directories}
              isLoading={isLoading}
              error={error}
              showFavorites={showFavorites && favorites.length > 0}
              isCreatingFolder={isCreatingFolder}
              currentPath={currentPath}
              newFolderName={newFolderName}
              isCreating={isCreating}
              createError={createError}
              newFolderInputRef={newFolderInputRef}
              onNavigate={onNavigate}
              onGoToDrives={onGoToDrives}
              onFolderNameChange={onFolderNameChange}
              onCreateConfirm={onCreateConfirm}
              onCreateCancel={onCreateCancel}
            />
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
          {favoritesOnlyMode ? (
            <>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                お気に入りからフォルダを選択してください
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
              >
                キャンセル
              </button>
            </>
          ) : (
            <>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                選択中:{' '}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">
                  {currentPath || 'なし'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={onSelect}
                  disabled={!currentPath}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                  選択
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

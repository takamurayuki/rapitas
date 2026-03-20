'use client';

/**
 * directory-picker/FavoritesOnlyPanel
 *
 * Full-height panel shown when the picker opens and the user has saved
 * favorites. Displays the favorites list and a button to switch to free
 * filesystem browsing. Not responsible for any data fetching.
 */

import { Folder, FolderOpen, GitBranch, Star, Trash2 } from 'lucide-react';
import type { FavoriteDirectory } from './types';

type FavoritesOnlyPanelProps = {
  favorites: FavoriteDirectory[];
  /** Currently selected path in the parent field */
  currentValue: string;
  onSelect: (path: string) => void;
  onRemove: (id: number) => void;
  onStartBrowsing: () => void;
};

/**
 * Renders a scrollable favorites list in full-panel mode.
 *
 * @param favorites - List of saved favorites / お気に入りリスト
 * @param currentValue - The path currently set in the picker input / 現在の選択値
 * @param onSelect - Called when a favorite is clicked / お気に入り選択時コールバック
 * @param onRemove - Called to delete a favorite by id / 削除時コールバック
 * @param onStartBrowsing - Called to exit favorites-only mode / ファイルシステム閲覧開始コールバック
 */
export function FavoritesOnlyPanel({
  favorites,
  currentValue,
  onSelect,
  onRemove,
  onStartBrowsing,
}: FavoritesOnlyPanelProps) {
  return (
    <div className="h-72 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/10 dark:to-amber-900/10 border-b border-yellow-100 dark:border-yellow-900/30">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
          <div>
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
              お気に入りから選択
            </span>
            <span className="text-xs text-yellow-600/70 dark:text-yellow-500/70 ml-2">
              ({favorites.length}件)
            </span>
          </div>
        </div>
        <button
          onClick={onStartBrowsing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 bg-white dark:bg-zinc-800 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-md transition-colors border border-purple-200 dark:border-purple-800"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          別のフォルダを選択
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
        {favorites.map((fav) => {
          const isCurrentValue = currentValue && fav.path === currentValue;
          return (
            <div
              key={fav.id}
              className={`flex items-center gap-2 px-4 py-3 transition-colors group ${
                isCurrentValue
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <button
                onClick={() => onSelect(fav.path)}
                className="flex-1 flex items-center gap-3 text-left min-w-0"
              >
                <Folder
                  className={`w-5 h-5 shrink-0 ${isCurrentValue ? 'text-purple-500' : 'text-yellow-500'}`}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-medium truncate ${isCurrentValue ? 'text-purple-700 dark:text-purple-300' : 'text-zinc-700 dark:text-zinc-300'}`}
                  >
                    {fav.name || fav.path.split(/[\\/]/).pop()}
                    {isCurrentValue && (
                      <span className="ml-2 text-xs font-normal text-purple-500 dark:text-purple-400">
                        (現在選択中)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate font-mono">
                    {fav.path}
                  </div>
                </div>
                {fav.isGitRepo && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded text-xs shrink-0">
                    <GitBranch className="w-3 h-3" />
                  </span>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(fav.id);
                }}
                className="p-1.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
                title="お気に入りから削除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

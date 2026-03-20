'use client';

/**
 * directory-picker/FavoritesSidebar
 *
 * Compact inline favorites list rendered above the directory listing when the
 * browser is in full (non-favorites-only) mode. Lets users quickly jump to a
 * saved path without leaving the browser panel.
 * Not responsible for any data fetching.
 */

import { Folder, GitBranch, Star, Trash2 } from 'lucide-react';
import type { FavoriteDirectory } from './types';

type FavoritesSidebarProps = {
  favorites: FavoriteDirectory[];
  /** Currently selected path in the parent field */
  currentValue: string;
  onNavigate: (path: string) => void;
  onRemove: (id: number) => void;
  onHide: () => void;
};

/**
 * Renders a compact scrollable list of favorites inside the browse panel.
 *
 * @param favorites - List of saved favorites / お気に入りリスト
 * @param currentValue - The path currently set in the picker input / 現在の選択値
 * @param onNavigate - Called to browse to a favorite path / パス移動コールバック
 * @param onRemove - Called to delete a favorite by id / 削除コールバック
 * @param onHide - Called to collapse this sidebar / 非表示コールバック
 */
export function FavoritesSidebar({
  favorites,
  currentValue,
  onNavigate,
  onRemove,
  onHide,
}: FavoritesSidebarProps) {
  if (favorites.length === 0) return null;

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/10 dark:to-amber-900/10">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
          <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
            お気に入り ({favorites.length})
          </span>
        </div>
        <button
          onClick={onHide}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          非表示
        </button>
      </div>

      <div className="max-h-32 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
        {favorites.map((fav) => {
          const isCurrentValue = currentValue && fav.path === currentValue;
          return (
            <div
              key={fav.id}
              className={`flex items-center gap-2 px-4 py-2 transition-colors group ${
                isCurrentValue
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <button
                onClick={() => onNavigate(fav.path)}
                className="flex-1 flex items-center gap-3 text-left min-w-0"
              >
                <Folder
                  className={`w-4 h-4 shrink-0 ${isCurrentValue ? 'text-purple-500' : 'text-yellow-500'}`}
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

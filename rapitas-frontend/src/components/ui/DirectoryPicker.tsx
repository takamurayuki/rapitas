'use client';

/**
 * DirectoryPicker
 *
 * Public entry-point for the directory-picker component family.
 * Composes useDirectoryPicker (state/logic) with the inline path display
 * and BrowserModal (full-screen directory browser).
 * Re-exports shared types for backward compatibility.
 */

import { Folder, FolderOpen, Check, X } from 'lucide-react';
import { useDirectoryPicker } from './directory-picker/useDirectoryPicker';
import { BrowserModal } from './directory-picker/BrowserModal';

// Re-export shared types so existing importers don't need to change their import paths.
export type {
  FavoriteDirectory,
  DirectoryEntry,
  BrowseResult,
} from './directory-picker/types';
import type { DirectoryPickerProps } from './directory-picker/types';

/**
 * A controlled directory-path input with an optional full-screen browser modal.
 * Supports favorites, manual path entry, new folder creation, and Git repo detection.
 *
 * @param value - Currently selected directory path / 現在選択中のディレクトリパス
 * @param onChange - Called when the user confirms a new path / パス確定時コールバック
 * @param placeholder - Input placeholder text / プレースホルダーテキスト
 * @param className - Additional CSS classes for the root element / 追加CSSクラス
 */
export function DirectoryPicker({
  value,
  onChange,
  placeholder = 'ディレクトリパスを入力または選択',
  className = '',
}: DirectoryPickerProps) {
  const picker = useDirectoryPicker(value, onChange);

  return (
    <div className={`relative ${className}`}>
      {/* Inline path display / edit field */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          {picker.isEditing ? (
            <div className="flex items-center">
              <input
                ref={picker.editInputRef}
                type="text"
                value={picker.editValue}
                onChange={(e) => picker.setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    picker.handleEditComplete();
                  } else if (e.key === 'Escape') {
                    picker.handleEditCancel();
                  }
                }}
                className="flex-1 rounded-lg border-2 border-purple-500 dark:border-purple-400 bg-white dark:bg-zinc-800 px-4 py-2.5 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30 transition-all font-mono"
                placeholder="パスを入力..."
              />
              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={picker.handleEditComplete}
                  className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                  title="確定"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={picker.handleEditCancel}
                  className="p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                  title="キャンセル"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 overflow-hidden">
              <div className="flex-1 flex items-center px-4 py-2.5 min-w-0">
                {value ? (
                  <>
                    <Folder className="w-4 h-4 text-amber-500 shrink-0 mr-2" />
                    <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">
                      {value}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-zinc-400 dark:text-zinc-500">
                    {placeholder}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={picker.handleStartEdit}
                className="px-3 py-2.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border-l border-zinc-300 dark:border-zinc-700 transition-colors"
                title="パスを直接入力"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={picker.handleOpen}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-all text-sm font-medium shrink-0"
          title="フォルダを参照"
        >
          <FolderOpen className="w-4 h-4" />
          参照
        </button>
      </div>

      {/* Directory browser modal */}
      {picker.isOpen && (
        <BrowserModal
          currentPath={picker.currentPath}
          directories={picker.directories}
          isGitRepo={picker.isGitRepo}
          isDriveList={picker.isDriveList}
          isLoading={picker.isLoading}
          error={picker.error}
          manualPath={picker.manualPath}
          onManualPathChange={picker.setManualPath}
          onGoUp={picker.handleGoUp}
          onGoToDrives={picker.handleGoToDrives}
          onGoToPath={picker.handleGoToPath}
          onNavigate={picker.handleNavigate}
          onSelect={picker.handleSelect}
          onClose={picker.handleClose}
          favorites={picker.favorites}
          currentValue={value}
          showFavorites={picker.showFavorites}
          onShowFavoritesChange={picker.setShowFavorites}
          favoritesOnlyMode={picker.favoritesOnlyMode}
          onStartBrowsing={picker.handleStartBrowsing}
          onSelectFavorite={onChange}
          onRemoveFavorite={picker.removeFromFavorites}
          onAddFavorite={picker.addToFavorites}
          isFavorite={picker.isFavorite}
          getFavoriteId={picker.getFavoriteId}
          isCreatingFolder={picker.isCreatingFolder}
          newFolderName={picker.newFolderName}
          isCreating={picker.isCreating}
          createError={picker.createError}
          newFolderInputRef={picker.newFolderInputRef}
          onStartCreateFolder={picker.handleStartCreateFolder}
          onFolderNameChange={picker.setNewFolderName}
          onCreateConfirm={picker.handleCreateFolder}
          onCreateCancel={picker.handleCancelCreateFolder}
        />
      )}
    </div>
  );
}

export default DirectoryPicker;

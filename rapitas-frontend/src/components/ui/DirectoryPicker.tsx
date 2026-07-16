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
import { useTranslations } from 'next-intl';
import { useDirectoryPicker } from './directory-picker/useDirectoryPicker';
import { BrowserModal } from './directory-picker/BrowserModal';

// Re-export shared types so existing importers don't need to change their import paths.
export type { FavoriteDirectory, DirectoryEntry, BrowseResult } from './directory-picker/types';
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
  placeholder,
  className = '',
}: DirectoryPickerProps) {
  const t = useTranslations('common');
  const resolvedPlaceholder = placeholder ?? t('directoryPicker.placeholder');
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
                className="flex-1 h-9 rounded-lg border border-indigo-500 dark:border-indigo-400 bg-white dark:bg-zinc-800 px-3 pr-20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors font-mono"
                placeholder={t('directoryPicker.pathInputPlaceholder')}
              />
              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={picker.handleEditComplete}
                  className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                  title={t('directoryPicker.confirm')}
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={picker.handleEditCancel}
                  className="p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                  title={t('cancel')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 overflow-hidden">
              <div className="flex-1 flex items-center px-3 min-w-0 h-full">
                {value ? (
                  <>
                    <Folder className="w-4 h-4 text-amber-500 shrink-0 mr-2" />
                    <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">
                      {value}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-zinc-500 dark:text-zinc-500">
                    {resolvedPlaceholder}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={picker.handleStartEdit}
                className="flex items-center h-full px-3 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border-l border-zinc-300 dark:border-zinc-700 transition-colors"
                title={t('directoryPicker.manualEntryTitle')}
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
          className="flex items-center gap-2 h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors text-sm font-medium shrink-0"
          title={t('directoryPicker.browseTitle')}
        >
          <FolderOpen className="w-4 h-4" />
          {t('directoryPicker.browse')}
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
          onSelectPath={picker.handleSelectPath}
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

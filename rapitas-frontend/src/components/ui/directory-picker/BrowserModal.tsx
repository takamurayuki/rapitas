'use client';

/**
 * directory-picker/BrowserModal
 *
 * Full-screen overlay modal that wraps the directory browser. Renders the
 * modal chrome (header, path input bar, filter bar, footer) and owns the
 * transient UI state (type-ahead filter, highlighted selection candidate).
 * Delegates toolbar, favorites panels, list, and footer to sub-components.
 * Not responsible for data fetching — receives all browse state via props.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, X, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FavoriteDirectory, DirectoryEntry } from './types';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserFooter } from './BrowserFooter';
import { FavoritesOnlyPanel } from './FavoritesOnlyPanel';
import { FavoritesSidebar } from './FavoritesSidebar';
import { DirectoryList } from './DirectoryList';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';
import { isImeComposing } from '@/utils/ime';

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
  onSelectPath: (path: string) => void;
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
  onSelectPath,
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
  const t = useTranslations('common');

  const panelRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Highlighted selection candidate (single click) and type-ahead filter.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // NOTE: Selection and filter are scoped to the directory being browsed —
  // reset both whenever navigation changes the path.
  useEffect(() => {
    setSelectedPath(null);
    setFilter('');
  }, [currentPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // NOTE: First Esc clears an active filter; only a second Esc closes.
      if (filter) {
        setFilter('');
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filter, onClose]);

  useFocusTrap(panelRef, true);

  // NOTE: Declared after useFocusTrap so this focus wins over the trap's
  // initial-focus (effects run in declaration order).
  useEffect(() => {
    if (!favoritesOnlyMode) filterInputRef.current?.focus();
  }, [favoritesOnlyMode]);

  const visibleDirectories = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return directories;
    return directories.filter((dir) => dir.name.toLowerCase().includes(q));
  }, [directories, filter]);

  const effectivePath = selectedPath ?? currentPath;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-modal-title"
        tabIndex={-1}
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
          <div className="flex items-center gap-3">
            <Folder className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
            <span
              id="browser-modal-title"
              className="font-semibold text-zinc-900 dark:text-zinc-50"
            >
              {t('directoryPicker.selectDirectory')}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
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
            onNavigate={onNavigate}
            onStartCreateFolder={onStartCreateFolder}
            onToggleFavorites={() => onShowFavoritesChange(!showFavorites)}
            onAddFavorite={onAddFavorite}
            onRemoveFavorite={onRemoveFavorite}
          />
        )}

        {/* Manual path input + type-ahead filter — hidden in favorites-only mode */}
        {!favoritesOnlyMode && (
          <>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => onManualPathChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isImeComposing(e)) onGoToPath();
                }}
                placeholder={t('directoryPicker.manualPathPlaceholder')}
                className="flex-1 px-3 py-1.5 text-sm font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:border-indigo-400"
              />
              <button
                onClick={onGoToPath}
                disabled={!manualPath.trim() || isLoading}
                className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('directoryPicker.move')}
              </button>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <Search className="w-4 h-4 text-zinc-400 shrink-0" />
              <input
                ref={filterInputRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label={t('directoryPicker.filterPlaceholder')}
                placeholder={t('directoryPicker.filterPlaceholder')}
                className="flex-1 bg-transparent text-sm text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  aria-label={t('directoryPicker.clearFilter')}
                  className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </>
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
              directories={visibleDirectories}
              isLoading={isLoading}
              error={error}
              showFavorites={showFavorites && favorites.length > 0}
              isCreatingFolder={isCreatingFolder}
              currentPath={currentPath}
              filter={filter.trim()}
              selectedPath={selectedPath}
              newFolderName={newFolderName}
              isCreating={isCreating}
              createError={createError}
              newFolderInputRef={newFolderInputRef}
              onSelectRow={(path) => setSelectedPath((prev) => (prev === path ? null : path))}
              onNavigate={onNavigate}
              onGoToDrives={onGoToDrives}
              onFolderNameChange={onFolderNameChange}
              onCreateConfirm={onCreateConfirm}
              onCreateCancel={onCreateCancel}
            />
          </>
        )}

        <BrowserFooter
          favoritesOnlyMode={favoritesOnlyMode}
          effectivePath={effectivePath}
          onConfirm={() => onSelectPath(effectivePath)}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

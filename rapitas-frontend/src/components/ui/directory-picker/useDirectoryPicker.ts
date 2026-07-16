'use client';

/**
 * directory-picker/useDirectoryPicker
 *
 * Custom hook that composes useFavorites and useFolderCreation with browser
 * navigation state and inline-edit logic for the DirectoryPicker component.
 * Not responsible for any JSX rendering.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import type { BrowseResult, FavoriteDirectory, DirectoryEntry } from './types';
import { useFavorites } from './useFavorites';
import { useFolderCreation, type UseFolderCreationReturn } from './useFolderCreation';

export type UseDirectoryPickerReturn = UseFolderCreationReturn & {
  isOpen: boolean;
  handleOpen: () => Promise<void>;
  handleClose: () => void;
  currentPath: string;
  directories: DirectoryEntry[];
  parentPath: string | null;
  isGitRepo: boolean;
  isDriveList: boolean;
  isLoading: boolean;
  error: string | null;
  manualPath: string;
  setManualPath: (v: string) => void;
  handleNavigate: (path: string) => void;
  handleGoUp: () => void;
  handleGoToDrives: () => void;
  handleGoToPath: () => void;
  handleSelectPath: (path: string) => void;
  favorites: FavoriteDirectory[];
  showFavorites: boolean;
  setShowFavorites: (v: boolean) => void;
  isLoadingFavorites: boolean;
  favoritesOnlyMode: boolean;
  handleStartBrowsing: () => void;
  addToFavorites: (path: string) => Promise<void>;
  removeFromFavorites: (id: number) => Promise<void>;
  isFavorite: (path: string) => boolean;
  getFavoriteId: (path: string) => number | undefined;
  isEditing: boolean;
  editValue: string;
  setEditValue: (v: string) => void;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  handleStartEdit: () => void;
  handleEditComplete: () => void;
  handleEditCancel: () => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Provides all state and handlers for the DirectoryPicker component.
 *
 * @param value - Currently selected directory path / 現在選択中のパス
 * @param onChange - Callback invoked when a new path is confirmed / パス確定時コールバック
 * @returns All state and handler values needed to render the picker UI
 */
export function useDirectoryPicker(
  value: string,
  onChange: (path: string) => void,
): UseDirectoryPickerReturn {
  const t = useTranslations('common');
  const {
    favorites,
    isLoadingFavorites,
    fetchFavorites,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    getFavoriteId,
    setFavorites,
  } = useFavorites();

  const [isOpen, setIsOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [isDriveList, setIsDriveList] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [showFavorites, setShowFavorites] = useState(true);
  const [favoritesOnlyMode, setFavoritesOnlyMode] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const handleEditComplete = useCallback(() => {
    if (editValue !== value) onChange(editValue);
    setIsEditing(false);
  }, [editValue, value, onChange]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        editInputRef.current &&
        !editInputRef.current.contains(event.target as Node) &&
        isEditing
      ) {
        handleEditComplete();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, handleEditComplete]);

  const browseDirectory = async (path?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const url = path
        ? `${API_BASE_URL}/directories/browse?path=${encodeURIComponent(path)}`
        : `${API_BASE_URL}/directories/browse`;
      const res = await fetch(url);
      const data: BrowseResult = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setCurrentPath(data.path);
      setDirectories(data.directories);
      setParentPath(data.parent);
      setIsGitRepo(data.isGitRepo || false);
      setIsDriveList(data.isDriveList || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('directoryPicker.fetchError'));
    } finally {
      setIsLoading(false);
    }
  };

  const folderCreation = useFolderCreation(currentPath, (createdPath) =>
    browseDirectory(createdPath),
  );

  const handleOpen = async () => {
    setIsOpen(true);
    setManualPath('');
    setShowFavorites(true);
    const data = await fetchFavorites();
    if (data && data.length > 0) {
      setFavorites(data);
      // NOTE: Skip directory browsing when favorites exist — prompt user to pick from favorites first.
      setFavoritesOnlyMode(true);
      setCurrentPath('');
      setDirectories([]);
      setParentPath(null);
      setIsGitRepo(false);
      setIsDriveList(false);
    } else {
      setFavoritesOnlyMode(false);
      // NOTE: Fall back to filesystem browsing when no favorites are saved.
      browseDirectory(value || undefined);
    }
  };

  const handleStartBrowsing = () => {
    setFavoritesOnlyMode(false);
    browseDirectory(value || undefined);
  };

  const handleClose = () => {
    setIsOpen(false);
    setError(null);
    setManualPath('');
    folderCreation.resetFolderCreation();
  };

  /**
   * Confirms the given path as the picker's value and closes the modal.
   * Used by the footer select button (highlighted row or current path).
   *
   * @param path - Directory path to confirm / 確定するディレクトリパス
   */
  const handleSelectPath = (path: string) => {
    if (path) {
      onChange(path);
      handleClose();
    }
  };

  const handleNavigate = (path: string) => browseDirectory(path);
  const handleGoUp = () => (parentPath ? browseDirectory(parentPath) : browseDirectory());
  const handleGoToDrives = () => browseDirectory();
  const handleGoToPath = () => {
    if (manualPath.trim()) browseDirectory(manualPath.trim());
  };

  const handleStartEdit = () => {
    setEditValue(value);
    setIsEditing(true);
    // NOTE: setTimeout defers focus until after React re-render commits the input to the DOM.
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditValue(value);
  };

  return {
    isOpen,
    handleOpen,
    handleClose,
    currentPath,
    directories,
    parentPath,
    isGitRepo,
    isDriveList,
    isLoading,
    error,
    manualPath,
    setManualPath,
    handleNavigate,
    handleGoUp,
    handleGoToDrives,
    handleGoToPath,
    handleSelectPath,
    favorites,
    showFavorites,
    setShowFavorites,
    isLoadingFavorites,
    favoritesOnlyMode,
    handleStartBrowsing,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    getFavoriteId,
    isEditing,
    editValue,
    setEditValue,
    editInputRef,
    handleStartEdit,
    handleEditComplete,
    handleEditCancel,
    ...folderCreation,
    dropdownRef,
  };
}

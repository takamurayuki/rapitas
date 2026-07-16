'use client';

/**
 * directory-picker/useFolderCreation
 *
 * State and handlers for the in-modal "create new folder" flow. Extracted
 * from useDirectoryPicker to keep both hooks within the size policy.
 * Not responsible for browsing — notifies the caller via onCreated.
 */

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

export type UseFolderCreationReturn = {
  isCreatingFolder: boolean;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  isCreating: boolean;
  createError: string | null;
  setCreateError: (v: string | null) => void;
  newFolderInputRef: React.RefObject<HTMLInputElement | null>;
  handleStartCreateFolder: () => void;
  handleCancelCreateFolder: () => void;
  handleCreateFolder: () => Promise<void>;
  resetFolderCreation: () => void;
};

/**
 * Provides the new-folder form state and creation API call.
 *
 * @param currentPath - Directory in which the folder will be created / フォルダ作成先パス
 * @param onCreated - Called with the created path (e.g. to browse into it) / 作成後コールバック
 * @returns Folder-creation state and handlers
 */
export function useFolderCreation(
  currentPath: string,
  onCreated: (path: string) => void,
): UseFolderCreationReturn {
  const t = useTranslations('common');

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const handleStartCreateFolder = () => {
    setIsCreatingFolder(true);
    setNewFolderName('');
    setCreateError(null);
    // NOTE: setTimeout defers focus until after React re-render commits the input to the DOM.
    setTimeout(() => {
      newFolderInputRef.current?.focus();
    }, 0);
  };

  const resetFolderCreation = () => {
    setIsCreatingFolder(false);
    setNewFolderName('');
    setCreateError(null);
  };

  const handleCancelCreateFolder = resetFolderCreation;

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setCreateError(t('directoryPicker.nameRequired'));
      return;
    }
    if (/[<>:"/\\|?*]/.test(newFolderName)) {
      setCreateError(t('directoryPicker.invalidChars'));
      return;
    }
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const newPath = currentPath
      ? `${currentPath}${currentPath.endsWith('\\') || currentPath.endsWith('/') ? '' : sep}${newFolderName.trim()}`
      : newFolderName.trim();
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/directories/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      const data = await res.json();
      if (!data.success) {
        setCreateError(data.error || t('directoryPicker.createError'));
        return;
      }
      resetFolderCreation();
      onCreated(data.path);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('directoryPicker.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  return {
    isCreatingFolder,
    newFolderName,
    setNewFolderName,
    isCreating,
    createError,
    setCreateError,
    newFolderInputRef,
    handleStartCreateFolder,
    handleCancelCreateFolder,
    handleCreateFolder,
    resetFolderCreation,
  };
}

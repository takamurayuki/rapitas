/**
 * useDirectoryStatus
 *
 * Manages directory validation, folder-creation state, and Git-branch fetching
 * for the theme development-project fields. Extracted from useThemesPage to
 * keep each hook under the 300-line file-size limit.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { FormData } from './useThemesPage';

const logger = createLogger('useDirectoryStatus');

export type DirStatus = {
  checking: boolean;
  exists: boolean | null;
  isGitRepo: boolean;
};

/**
 * Handles directory validation, creation, and branch listing for a theme form.
 *
 * @param getFormData - Accessor returning the current form state (avoids stale closure).
 * @param setFormData - Setter for the shared form state.
 * @param getEditingId - Accessor returning the current editingId value.
 * @returns Directory/branch state and the action handlers that mutate it.
 */
export function useDirectoryStatus(
  getFormData: () => FormData,
  setFormData: (updater: (prev: FormData) => FormData) => void,
  getEditingId: () => number | null,
) {
  const t = useTranslations('themes');
  const { showToast } = useToast();

  const [dirStatus, setDirStatus] = useState<DirStatus>({
    checking: false,
    exists: null,
    isGitRepo: false,
  });
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingDir, setIsCreatingDir] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  /**
   * Fetches available branches for a Git repository URL.
   *
   * @param repoUrl - Remote Git repository URL to query.
   */
  const fetchBranches = async (repoUrl: string) => {
    if (!repoUrl.trim()) {
      setBranches([]);
      setBranchError(null);
      return;
    }

    setLoadingBranches(true);
    setBranchError(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}/themes/branches?repositoryUrl=${encodeURIComponent(repoUrl)}`,
      );
      const data = await res.json();

      if (res.ok && data.success) {
        setBranches(data.branches || []);
        // Auto-select first branch if current defaultBranch is not in the list
        if (data.branches.length > 0 && !data.branches.includes(getFormData().defaultBranch)) {
          setFormData((prev) => ({ ...prev, defaultBranch: data.branches[0] }));
        }
      } else {
        setBranchError(data.message || 'ブランチの取得に失敗しました');
        setBranches([]);
      }
    } catch (error) {
      logger.error('Failed to fetch branches:', error);
      setBranchError('ブランチの取得中にエラーが発生しました');
      setBranches([]);
    } finally {
      setLoadingBranches(false);
    }
  };

  /**
   * Validates whether a local directory path exists and whether it is a Git repo.
   *
   * @param dirPath - Absolute local filesystem path to validate.
   */
  const checkDirectory = async (dirPath: string) => {
    if (!dirPath.trim()) {
      setDirStatus({ checking: false, exists: null, isGitRepo: false });
      return;
    }

    setDirStatus({ checking: true, exists: null, isGitRepo: false });

    try {
      const res = await fetch(`${API_BASE_URL}/directories/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();

      setDirStatus({
        checking: false,
        exists: data.valid,
        isGitRepo: data.isGitRepo || false,
      });

      // Auto-fill repository URL if detected and form is empty (new theme creation)
      if (data.valid && data.remoteUrl && !getFormData().repositoryUrl && !getEditingId()) {
        setFormData((prev) => ({ ...prev, repositoryUrl: data.remoteUrl }));
        fetchBranches(data.remoteUrl);
      }

      if (!data.valid) {
        setShowCreateFolder(true);
        const segments = dirPath.replace(/[\\/]+$/, '').split(/[\\/]/);
        setNewFolderName(segments[segments.length - 1] || '');
      } else {
        setShowCreateFolder(false);
        setNewFolderName('');
      }
    } catch {
      setDirStatus({ checking: false, exists: null, isGitRepo: false });
    }
  };

  /**
   * Creates the exact directory path stored in formData.workingDirectory.
   */
  const handleCreateDirectory = async () => {
    const dirPath = getFormData().workingDirectory.trim();
    if (!dirPath) return;

    setIsCreatingDir(true);

    try {
      const res = await fetch(`${API_BASE_URL}/directories/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();

      if (data.success) {
        showToast(t('folderCreated'), 'success');
        setDirStatus({ checking: false, exists: true, isGitRepo: false });
        setShowCreateFolder(false);
        setNewFolderName('');
      } else {
        showToast(data.error || t('folderCreateFailed'), 'error');
      }
    } catch {
      showToast(t('folderCreateFailed'), 'error');
    } finally {
      setIsCreatingDir(false);
    }
  };

  /**
   * Creates a new folder with a user-supplied name under the parent of
   * formData.workingDirectory, then updates formData.workingDirectory to the new path.
   */
  const handleCreateNewFolder = async () => {
    if (!newFolderName.trim()) {
      showToast(t('folderNameRequired'), 'error');
      return;
    }

    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(newFolderName)) {
      showToast(t('folderNameInvalid'), 'error');
      return;
    }

    const currentPath = getFormData().workingDirectory.trim();
    const parentPath = currentPath.replace(/[\\/][^\\/]*[\\/]?$/, '');
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const newPath = parentPath + separator + newFolderName.trim();

    setIsCreatingDir(true);

    try {
      const res = await fetch(`${API_BASE_URL}/directories/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      const data = await res.json();

      if (data.success) {
        showToast(t('folderCreated'), 'success');
        setFormData((prev) => ({ ...prev, workingDirectory: data.path }));
        setDirStatus({ checking: false, exists: true, isGitRepo: false });
        setShowCreateFolder(false);
        setNewFolderName('');
      } else {
        showToast(data.error || t('folderCreateFailed'), 'error');
      }
    } catch {
      showToast(t('folderCreateFailed'), 'error');
    } finally {
      setIsCreatingDir(false);
    }
  };

  /** Resets all directory and branch state to initial values. */
  const resetDirectoryState = () => {
    setDirStatus({ checking: false, exists: null, isGitRepo: false });
    setShowCreateFolder(false);
    setNewFolderName('');
    setBranches([]);
    setBranchError(null);
  };

  return {
    dirStatus,
    newFolderName,
    setNewFolderName,
    isCreatingDir,
    showCreateFolder,
    branches,
    setBranches,
    loadingBranches,
    branchError,
    setBranchError,
    fetchBranches,
    checkDirectory,
    handleCreateDirectory,
    handleCreateNewFolder,
    resetDirectoryState,
  };
}

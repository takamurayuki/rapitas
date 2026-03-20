/**
 * DevProjectFields
 *
 * Renders the "Development Project" collapsible section inside ThemeForm,
 * including repository URL, working directory picker, directory status
 * indicator, and default branch selector. Folder-creation UI is delegated
 * to FolderCreator.
 */
import {
  Code,
  FolderGit2,
  FolderOpen,
  CheckCircle,
  Loader2,
  GitBranch,
  AlertCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DirectoryPicker } from '@/components/ui/DirectoryPicker';
import type { FormData } from '../_hooks/useThemesPage';
import type { Category } from '@/types';
import { FolderCreator } from './folder-creator';

type DirStatus = {
  checking: boolean;
  exists: boolean | null;
  isGitRepo: boolean;
};

type Props = {
  formData: FormData;
  setFormData: (data: FormData) => void;
  categories: Category[];
  dirStatus: DirStatus;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  isCreatingDir: boolean;
  showCreateFolder: boolean;
  branches: string[];
  loadingBranches: boolean;
  branchError: string | null;
  setBranches: (b: string[]) => void;
  setBranchError: (e: string | null) => void;
  editingId: number | null;
  onCheckDirectory: (path: string) => void;
  onFetchBranches: (repoUrl: string) => void;
  onCreateDirectory: () => void;
  onCreateNewFolder: () => void;
};

/**
 * Development-project sub-section of the theme form.
 *
 * @param props.formData - Current form values.
 * @param props.setFormData - Setter for form values.
 * @param props.editingId - Non-null when editing an existing theme (suppresses auto-detect banner).
 */
export function DevProjectFields({
  formData,
  setFormData,
  categories,
  dirStatus,
  newFolderName,
  setNewFolderName,
  isCreatingDir,
  showCreateFolder,
  branches,
  loadingBranches,
  branchError,
  setBranches,
  setBranchError,
  editingId,
  onCheckDirectory,
  onFetchBranches,
  onCreateDirectory,
  onCreateNewFolder,
}: Props) {
  const t = useTranslations('themes');

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 space-y-3">
      {/* isDevelopment checkbox */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={formData.isDevelopment}
          onChange={(e) => {
            const checked = e.target.checked;
            if (checked && !formData.categoryId) {
              const devCategory = categories.find(
                (c) => c.name === '開発' && c.isDefault,
              );
              setFormData({
                ...formData,
                isDevelopment: true,
                categoryId: devCategory?.id ?? formData.categoryId,
              });
            } else {
              setFormData({ ...formData, isDevelopment: checked });
            }
          }}
          className="w-4 h-4 rounded border-zinc-300 text-purple-600 focus:ring-purple-500"
        />
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Code className="w-3.5 h-3.5" />
          {t('devProject')}
        </span>
      </label>

      {formData.isDevelopment && (
        <div className="space-y-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
          <p className="text-xs text-purple-700 dark:text-purple-300 mb-2">
            {t('devProjectDescription')}
          </p>

          {/* Repository URL */}
          <div>
            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1.5">
              <FolderGit2 className="w-3.5 h-3.5" />
              {t('githubRepoUrl')}
            </label>
            <input
              type="text"
              value={formData.repositoryUrl}
              onChange={(e) => {
                const newUrl = e.target.value;
                setFormData({ ...formData, repositoryUrl: newUrl });
                if (newUrl.trim()) {
                  onFetchBranches(newUrl);
                } else {
                  setBranches([]);
                  setBranchError(null);
                }
              }}
              onBlur={(e) => {
                // Fetch branches on blur if not already loaded
                const url = e.target.value.trim();
                if (url && branches.length === 0 && !loadingBranches) {
                  onFetchBranches(url);
                }
              }}
              placeholder="https://github.com/username/repository"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
            {dirStatus.isGitRepo && formData.repositoryUrl && !editingId && (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                リポジトリURLを自動検出しました
              </p>
            )}
          </div>

          {/* Working directory */}
          <div>
            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              {t('workingDirectory')}
            </label>
            <DirectoryPicker
              value={formData.workingDirectory}
              onChange={(path) => {
                setFormData({ ...formData, workingDirectory: path });
                onCheckDirectory(path);
              }}
              placeholder="C:\Projects\my-project / /home/user/projects/my-project"
            />

            {formData.workingDirectory.trim() && (
              <div className="mt-2">
                {dirStatus.checking ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t('checkingFolder')}
                  </div>
                ) : dirStatus.exists === true ? (
                  <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {t('folderFound')}
                    {dirStatus.isGitRepo && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 rounded text-xs">
                        <GitBranch className="w-3 h-3" />
                        Git
                      </span>
                    )}
                  </div>
                ) : dirStatus.exists === false ? (
                  <FolderCreator
                    newFolderName={newFolderName}
                    setNewFolderName={setNewFolderName}
                    isCreatingDir={isCreatingDir}
                    showCreateFolder={showCreateFolder}
                    onCreateDirectory={onCreateDirectory}
                    onCreateNewFolder={onCreateNewFolder}
                  />
                ) : null}
              </div>
            )}

            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t('workingDirectoryHelp')}
            </p>
          </div>

          {/* Default branch */}
          <div>
            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" />
              {t('defaultBranch')}
              {loadingBranches && (
                <Loader2 className="w-3 h-3 animate-spin text-purple-500" />
              )}
            </label>

            {branches.length > 0 ? (
              <select
                value={formData.defaultBranch}
                onChange={(e) =>
                  setFormData({ ...formData, defaultBranch: e.target.value })
                }
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              >
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                    {branch === 'develop' && ' (推奨)'}
                    {branch === 'main' && branches.length > 1 && ' (GitHub Flow)'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={formData.defaultBranch}
                onChange={(e) =>
                  setFormData({ ...formData, defaultBranch: e.target.value })
                }
                placeholder="develop"
                disabled={loadingBranches}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
            )}

            {branchError && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {branchError}
              </p>
            )}

            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {branches.length > 0
                ? `${branches.length}個のブランチが見つかりました`
                : 'リポジトリURLを入力するとブランチ一覧が表示されます'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

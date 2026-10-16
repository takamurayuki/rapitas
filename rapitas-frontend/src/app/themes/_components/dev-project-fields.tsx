/**
 * DevProjectFields
 *
 * Renders the "Development Project" section of ThemeForm as a three-step
 * setup pipeline (working directory → repository → branch), where each step
 * communicates its state via icon + chip instead of prose. Folder-creation UI
 * is delegated to FolderCreator, repo/branch actions to RepoInitializer and
 * BranchCreator.
 */
import { useEffect, useRef } from 'react';
import { Code, FolderGit2, FolderOpen, GitBranch, AlertCircle, AppWindow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DirectoryPicker } from '@/components/ui/DirectoryPicker';
import { RuntimeConfigEditor } from '@/components/runtime-config/RuntimeConfigEditor';
import type { FormData } from '../_hooks/useThemesPage';
import type { Category } from '@/types';
import { FolderCreator } from './folder-creator';
import { RepoInitializer } from './repo-initializer';
import { BranchCreator } from './branch-creator';
import { SetupStep, type StepState } from './setup-step';

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

// Shared control metrics for every input/select in this section (h-9 rows).
const inputClass =
  'w-full h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors';

// A URL is worth querying only once it names owner AND repository — firing on
// every keystroke queried partial URLs whose failures raced the real one.
const COMPLETE_REPO_URL = /github\.com[/:][\w.-]+\/[\w.-]+/;

/** Debounce (ms) between typing pauses and the automatic branch fetch. */
const BRANCH_FETCH_DEBOUNCE_MS = 500;

/**
 * Development-project sub-section of the theme form.
 *
 * @param props.formData - Current form values.
 * @param props.setFormData - Setter for form values.
 * @param props.editingId - Non-null when editing an existing theme; used as the
 *   RuntimeConfigEditor's remount key so switching between themes (or to "new")
 *   re-parses its value instead of fighting the previous target's typed state.
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

  // Debounced branch fetch for typed URLs (programmatic fetches stay immediate).
  const branchFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (branchFetchTimer.current) clearTimeout(branchFetchTimer.current);
    };
  }, []);
  const scheduleBranchFetch = (url: string) => {
    if (branchFetchTimer.current) clearTimeout(branchFetchTimer.current);
    if (!COMPLETE_REPO_URL.test(url)) return; // partial URL — wait for more input
    branchFetchTimer.current = setTimeout(() => onFetchBranches(url), BRANCH_FETCH_DEBOUNCE_MS);
  };

  const dirState: StepState = dirStatus.checking
    ? 'checking'
    : !formData.workingDirectory.trim()
      ? 'pending'
      : dirStatus.exists === true
        ? 'done'
        : dirStatus.exists === false
          ? 'attention'
          : 'pending';

  const repoState: StepState = formData.repositoryUrl.trim()
    ? 'done'
    : dirStatus.exists === true
      ? 'attention'
      : 'pending';

  const branchState: StepState = loadingBranches
    ? 'checking'
    : branchError
      ? 'attention'
      : branches.length > 0
        ? 'done'
        : 'pending';

  // Lightweight client-side sanity check only (non-empty required fields) —
  // full shape validation (URL format, timeout clamping, etc.) is the
  // backend's job at save time (parseRuntimeConfig), not duplicated here.
  // RuntimeConfigEditor always serializes well-formed JSON with start/url as
  // strings, so checking `typeof` alone would read "done" the instant any
  // field is touched even with start/url still blank — trim().length is the
  // actual signal that those two required fields are filled in.
  const runtimeConfigState: StepState = (() => {
    const raw = formData.runtimeConfigJson.trim();
    if (!raw) return 'pending';
    try {
      const parsed: unknown = JSON.parse(raw);
      const o = parsed as Record<string, unknown>;
      const start = typeof o?.start === 'string' ? o.start.trim() : '';
      const url = typeof o?.url === 'string' ? o.url.trim() : '';
      return start && url ? 'done' : 'attention';
    } catch {
      return 'attention';
    }
  })();

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 space-y-3">
      {/* isDevelopment checkbox */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={formData.isDevelopment}
          onChange={(e) => {
            const checked = e.target.checked;
            if (checked && !formData.categoryId) {
              const devCategory = categories.find((c) => c.name === '開発' && c.isDefault);
              setFormData({
                ...formData,
                isDevelopment: true,
                categoryId: devCategory?.id ?? formData.categoryId,
              });
            } else {
              setFormData({ ...formData, isDevelopment: checked });
            }
          }}
          className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Code className="w-3.5 h-3.5" />
          {t('devProject')}
        </span>
      </label>

      {formData.isDevelopment && (
        <div className="p-4 bg-zinc-50 dark:bg-zinc-900/40 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {/* Step 1 — working directory */}
          <SetupStep
            state={dirState}
            label={t('stepWorkingDirectory')}
            labelIcon={<FolderOpen className="w-3.5 h-3.5" />}
          >
            <DirectoryPicker
              value={formData.workingDirectory}
              onChange={(path) => {
                setFormData({ ...formData, workingDirectory: path });
                onCheckDirectory(path);
              }}
              placeholder="C:\Projects\my-project / /home/user/projects/my-project"
            />
            {formData.workingDirectory.trim() && dirStatus.exists === false && (
              <div className="mt-2">
                <FolderCreator
                  newFolderName={newFolderName}
                  setNewFolderName={setNewFolderName}
                  isCreatingDir={isCreatingDir}
                  showCreateFolder={showCreateFolder}
                  onCreateDirectory={onCreateDirectory}
                  onCreateNewFolder={onCreateNewFolder}
                />
              </div>
            )}
          </SetupStep>

          {/* Step 2 — repository (git / GitHub) */}
          <SetupStep
            state={repoState}
            label={t('stepRepository')}
            labelIcon={<FolderGit2 className="w-3.5 h-3.5" />}
            badge={
              dirStatus.isGitRepo ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                  <GitBranch className="w-3 h-3" />
                  Git
                </span>
              ) : undefined
            }
          >
            <RepoInitializer
              workingDirectory={formData.workingDirectory.trim()}
              defaultBranch={formData.defaultBranch}
              showButton={
                !dirStatus.checking &&
                dirStatus.exists === true &&
                (!dirStatus.isGitRepo || !formData.repositoryUrl.trim())
              }
              onInitialized={(repositoryUrl) => {
                setFormData({ ...formData, repositoryUrl });
                onFetchBranches(repositoryUrl);
                onCheckDirectory(formData.workingDirectory);
              }}
            >
              <input
                type="text"
                value={formData.repositoryUrl}
                onChange={(e) => {
                  const newUrl = e.target.value;
                  setFormData({ ...formData, repositoryUrl: newUrl });
                  if (newUrl.trim()) {
                    scheduleBranchFetch(newUrl);
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
                aria-label={t('githubRepoUrl')}
                title={t('githubRepoUrl')}
                placeholder="https://github.com/username/repository"
                className={inputClass}
              />
            </RepoInitializer>
          </SetupStep>

          {/* Step 3 — default branch */}
          <SetupStep
            state={branchState}
            label={t('stepBranch')}
            labelIcon={<GitBranch className="w-3.5 h-3.5" />}
          >
            {branches.length > 0 ? (
              <select
                value={formData.defaultBranch}
                onChange={(e) => setFormData({ ...formData, defaultBranch: e.target.value })}
                aria-label={t('defaultBranch')}
                className={inputClass}
              >
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                    {branch === 'develop' && ` ${t('branchRecommendedSuffix')}`}
                    {branch === 'main' && branches.length > 1 && ' (GitHub Flow)'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={formData.defaultBranch}
                onChange={(e) => setFormData({ ...formData, defaultBranch: e.target.value })}
                aria-label={t('defaultBranch')}
                placeholder="develop"
                disabled={loadingBranches}
                className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
              />
            )}

            {branchError && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {branchError}
              </p>
            )}

            <BranchCreator
              workingDirectory={formData.workingDirectory.trim()}
              branches={branches}
              defaultBranch={formData.defaultBranch}
              enabled={dirStatus.exists === true && dirStatus.isGitRepo}
              onCreated={(branch, pushed) => {
                setFormData({ ...formData, defaultBranch: branch });
                // NOTE: Only refresh the remote branch list when the branch was
                // pushed — a local-only branch is not listed remotely, and the
                // refresh would auto-reset defaultBranch to the first entry.
                if (pushed && formData.repositoryUrl.trim()) {
                  onFetchBranches(formData.repositoryUrl);
                }
              }}
            />
          </SetupStep>

          {/* Step 4 — runtime config (live preview + runtime verification) */}
          <SetupStep
            state={runtimeConfigState}
            label={t('stepRuntimeConfig')}
            labelIcon={<AppWindow className="w-3.5 h-3.5" />}
            isLast
          >
            <RuntimeConfigEditor
              key={editingId ?? 'new'}
              value={formData.runtimeConfigJson}
              onChange={(json) => setFormData({ ...formData, runtimeConfigJson: json })}
            />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t('runtimeConfigHelp')}
            </p>
          </SetupStep>
        </div>
      )}
    </div>
  );
}

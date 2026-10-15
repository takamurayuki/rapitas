/**
 * BranchCreator
 *
 * Inline "create a new Git branch" affordance for the theme dev-project form:
 * POSTs to /themes/create-branch and reports created/pushed results.
 * Not responsible for form state — reports the new branch via onCreated.
 */
import { useEffect, useState } from 'react';
import { Plus, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { isImeComposing } from '@/utils/ime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BranchCreator');

type CreateBranchResponse =
  | { success: true; branch: string; steps: { created: boolean; pushed: boolean } }
  | {
      success: false;
      error: string;
      code: 'path_not_found' | 'not_a_repo' | 'invalid_branch_name' | 'no_remote' | 'git_failed';
    };

type Props = {
  workingDirectory: string;
  branches: string[];
  defaultBranch: string;
  enabled: boolean;
  onCreated: (branch: string, pushed: boolean) => void;
};

/**
 * Renders the branch-creation toggle, inline form (name + optional base
 * branch), and success/error feedback.
 *
 * @param props.workingDirectory - Local repository path / ローカルリポジトリのパス
 * @param props.branches - Already-fetched branch list for the base select / ベース選択用の既取得ブランチ一覧
 * @param props.defaultBranch - Current default branch (initial base) / 現在のデフォルトブランチ
 * @param props.enabled - Whether branch creation is possible / ブランチ作成可能フラグ
 * @param props.onCreated - Called with the new branch name and push result / 新ブランチ名とpush結果を受け取るコールバック
 */
export function BranchCreator({
  workingDirectory,
  branches,
  defaultBranch,
  enabled,
  onCreated,
}: Props) {
  const t = useTranslations('themes');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // NOTE: Results belong to the repo they were produced for — clear when the
  // form points at a different directory.
  useEffect(() => {
    setError(null);
    setSuccessMessage(null);
    setOpen(false);
    setBranchName('');
  }, [workingDirectory]);

  const effectiveBase = baseBranch || defaultBranch || branches[0] || '';

  const handleCreate = async () => {
    const name = branchName.trim();
    if (!name) {
      setError(t('createBranchNameRequired'));
      return;
    }
    setCreating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/themes/create-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: workingDirectory,
          branchName: name,
          baseBranch: effectiveBase || undefined,
        }),
      });
      const data: CreateBranchResponse = await res.json();
      if (data.success) {
        setSuccessMessage(
          data.steps.pushed
            ? t('createBranchSuccessPushed', { branch: data.branch })
            : t('createBranchSuccessLocalOnly', { branch: data.branch }),
        );
        setOpen(false);
        setBranchName('');
        onCreated(data.branch, data.steps.pushed);
      } else {
        setError(
          data.code === 'invalid_branch_name'
            ? t('createBranchInvalidName')
            : data.error || t('createBranchFailed'),
        );
      }
    } catch (e) {
      logger.error('Failed to create branch:', e);
      setError(t('createBranchFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-1.5 space-y-1.5">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setError(null);
            setSuccessMessage(null);
          }}
          disabled={!enabled}
          title={enabled ? undefined : t('createBranchDisabledHint')}
          className="flex items-center gap-1 h-9 px-3 -ml-3 rounded-lg text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Plus className="w-4 h-4" />
          {t('createBranchAction')}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) {
                e.preventDefault();
                handleCreate();
              }
            }}
            aria-label={t('createBranchAction')}
            placeholder={t('createBranchPlaceholder')}
            disabled={creating}
            className="flex-1 min-w-0 h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 text-sm font-mono focus:outline-none focus:border-indigo-400 transition-colors disabled:opacity-50"
          />
          {branches.length > 0 && (
            <select
              value={effectiveBase}
              onChange={(e) => setBaseBranch(e.target.value)}
              disabled={creating}
              aria-label={t('createBranchBaseLabel')}
              title={t('createBranchBaseLabel')}
              className="h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors disabled:opacity-50"
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !branchName.trim()}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('createBranchConfirm')}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setBranchName('');
              setError(null);
            }}
            disabled={creating}
            aria-label={tc('cancel')}
            className="flex h-9 w-9 items-center justify-center text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {successMessage && (
        <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <CheckCircle className="w-3 h-3 shrink-0" />
          {successMessage}
        </p>
      )}
      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

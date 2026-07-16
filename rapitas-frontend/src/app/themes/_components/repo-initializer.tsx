/**
 * RepoInitializer
 *
 * One-click GitHub repository initialization block for the theme dev-project
 * form: POSTs to /themes/init-repository and reports per-step results.
 * Not responsible for form state — reports the created URL via onInitialized.
 */
import { useEffect, useState } from 'react';
import { FolderGit2, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RepoInitializer');

type InitSteps = {
  gitInit: boolean;
  initialCommit: boolean;
  repoCreated: boolean;
  pushed: boolean;
};

type InitRepositoryResponse =
  | { success: true; repositoryUrl: string; branch: string; steps: InitSteps }
  | { success: false; error: string; code: string };

type Props = {
  workingDirectory: string;
  defaultBranch: string;
  showButton: boolean;
  onInitialized: (repositoryUrl: string) => void;
  /** The repository-URL input, rendered in the same row as the 初期化 button. */
  children: React.ReactNode;
};

/**
 * Renders the repository-URL row: the URL input (children) and the 初期化
 * button side by side, with per-step progress / error feedback below.
 *
 * @param props.workingDirectory - Local path to initialize / 初期化対象のローカルパス
 * @param props.defaultBranch - Branch name for the initial push / 初回push先ブランチ名
 * @param props.showButton - Whether the action button is applicable / ボタン表示可否
 * @param props.onInitialized - Called with the created repository URL / 作成されたリポジトリURLを受け取るコールバック
 * @param props.children - The URL input composed into the row / 同じ行に配置するURL入力
 */
export function RepoInitializer({
  workingDirectory,
  defaultBranch,
  showButton,
  onInitialized,
  children,
}: Props) {
  const t = useTranslations('themes');
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // NOTE: Result messages belong to the path they were produced for — clear
  // them when the user points the form at a different directory.
  useEffect(() => {
    setError(null);
    setSuccessMessage(null);
  }, [workingDirectory]);

  const handleInitialize = async () => {
    setInitializing(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/themes/init-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // NOTE: repoName omitted on purpose — the server derives it from the folder name.
        body: JSON.stringify({
          path: workingDirectory,
          defaultBranch: defaultBranch || 'develop',
        }),
      });
      const data: InitRepositoryResponse = await res.json();
      if (data.success) {
        const stepLabels = [
          data.steps.gitInit && t('repoInitStepGitInit'),
          data.steps.initialCommit && t('repoInitStepInitialCommit'),
          data.steps.repoCreated && t('repoInitStepRepoCreated'),
          data.steps.pushed && t('repoInitStepPushed'),
        ].filter((label): label is string => Boolean(label));
        setSuccessMessage(t('repoInitSuccess', { steps: stepLabels.join(' / ') }));
        onInitialized(data.repositoryUrl);
      } else {
        setError({ message: data.error || t('repoInitFailed'), code: data.code });
      }
    } catch (e) {
      logger.error('Failed to initialize repository:', e);
      setError({ message: t('repoInitFailed'), code: 'network_error' });
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {/* URL input and the 初期化 action share one row (uniform h-9). */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        {showButton && (
          <button
            type="button"
            onClick={handleInitialize}
            disabled={initializing || !workingDirectory}
            // NOTE: The pipeline explanation lives in the tooltip, not visible copy.
            title={t('repoInitExplainer')}
            className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {initializing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FolderGit2 className="w-4 h-4" />
            )}
            {t('repoInitButton')}
          </button>
        )}
      </div>
      {successMessage && (
        <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <CheckCircle className="w-3 h-3 shrink-0" />
          {successMessage}
        </p>
      )}
      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            {error.message}
            {error.code === 'gh_unauthenticated' && (
              <>
                <br />
                {t('repoInitGhAuthHint')}
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}

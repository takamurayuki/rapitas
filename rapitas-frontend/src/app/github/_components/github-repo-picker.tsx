/**
 * GitHubRepoPicker
 *
 * The gh-CLI repo picker inside the add-integration modal: a refreshable list of
 * the authenticated user's repos with one-click add and per-row added/adding state.
 */
'use client';
import { useTranslations } from 'next-intl';
import { RefreshCw, Loader2, Check, Plus, FolderGit2 } from 'lucide-react';
import type { AvailableRepo } from './github-dashboard.types';

interface GitHubRepoPickerProps {
  repos: AvailableRepo[];
  loadingRepos: boolean;
  reposLoaded: boolean;
  repoError: string;
  /** Names already added this session (in addition to repo.alreadyAdded). / 今セッションで追加済みの名前。 */
  addedSet: Set<string>;
  /** Name of the repo currently being added, or null. / 追加処理中のリポジトリ名。なければnull。 */
  addingRepo: string | null;
  /** Refetch the repo list. / リポジトリ一覧を再取得。 */
  onReload: () => void;
  /** Add the given repo as an integration. / 指定リポジトリを連携として追加。 */
  onAdd: (repo: AvailableRepo) => void;
}

/** Single repo row with add / added affordance. */
function RepoRow({
  repo,
  isAdded,
  isAdding,
  onAdd,
}: {
  repo: AvailableRepo;
  isAdded: boolean;
  isAdding: boolean;
  onAdd: (repo: AvailableRepo) => void;
}) {
  const t = useTranslations('github');
  const tc = useTranslations('common');
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
      <FolderGit2 className="w-4 h-4 shrink-0 text-indigo-500" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {repo.nameWithOwner}
          </span>
          {repo.visibility && (
            <span className="shrink-0 text-[10px] uppercase px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">
              {repo.visibility}
            </span>
          )}
        </div>
        {repo.description && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{repo.description}</p>
        )}
      </div>
      {isAdded ? (
        <span className="flex items-center gap-1 shrink-0 text-xs text-green-600 dark:text-green-400">
          <Check className="w-3.5 h-3.5" />
          {t('added')}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onAdd(repo)}
          disabled={isAdding}
          className="flex items-center gap-1 shrink-0 px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isAdding ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          {tc('add')}
        </button>
      )}
    </div>
  );
}

/**
 * Render the gh repo picker section.
 *
 * @param props - Repo list, fetch/error/added state, and reload/add handlers. / リポジトリ一覧・取得/エラー/追加済み状態・再取得/追加ハンドラ。
 */
export function GitHubRepoPicker({
  repos,
  loadingRepos,
  reposLoaded,
  repoError,
  addedSet,
  addingRepo,
  onReload,
  onAdd,
}: GitHubRepoPickerProps) {
  const t = useTranslations('github');

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('pickFromGh')}
        </label>
        <button
          type="button"
          onClick={onReload}
          disabled={loadingRepos}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md transition-colors disabled:opacity-50"
        >
          {loadingRepos ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {reposLoaded ? t('reload') : t('fetchRepos')}
        </button>
      </div>

      {repoError && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{repoError}</p>}

      {loadingRepos ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-zinc-100 dark:bg-zinc-700 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : reposLoaded && repos.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 py-2">{t('noReposFound')}</p>
      ) : repos.length > 0 ? (
        <div className="max-h-56 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-700 scrollbar-thin">
          {repos.map((repo) => (
            <RepoRow
              key={repo.nameWithOwner}
              repo={repo}
              isAdded={repo.alreadyAdded || addedSet.has(repo.nameWithOwner)}
              isAdding={addingRepo === repo.nameWithOwner}
              onAdd={onAdd}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

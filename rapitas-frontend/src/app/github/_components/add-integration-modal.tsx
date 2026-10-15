/**
 * AddIntegrationModal
 *
 * Modal for linking a GitHub repository: a gh-CLI repo picker plus a manual
 * URL-entry form. State lives in {@link useAddIntegration}; this is the shell.
 */
'use client';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useAddIntegration } from '../_hooks/use-add-integration';
import { GitHubRepoPicker } from './github-repo-picker';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';

interface AddIntegrationModalProps {
  /** Close the modal without refreshing. / 更新せずに閉じる。 */
  onClose: () => void;
  /** Close and refresh the parent after a successful add. / 追加成功後に閉じて親を更新。 */
  onSuccess: () => void;
}

/**
 * Render the add-integration modal.
 *
 * @param props - Close/success callbacks owned by the page. / ページが持つ閉じる/成功コールバック。
 */
export function AddIntegrationModal({ onClose, onSuccess }: AddIntegrationModalProps) {
  const t = useTranslations('github');
  const tc = useTranslations('common');
  const {
    repositoryUrl,
    setRepositoryUrl,
    saving,
    error,
    repos,
    loadingRepos,
    reposLoaded,
    repoError,
    addedSet,
    addingRepo,
    changed,
    loadRepos,
    addRepo,
    handleSubmit,
    handleClose,
  } = useAddIntegration({ onSuccess, onClose });

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  useFocusTrap(panelRef, true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-integration-modal-title"
        tabIndex={-1}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-zinc-800 rounded-lg shadow-xl scrollbar-thin"
      >
        <div className="p-6">
          <h2
            id="add-integration-modal-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4"
          >
            {t('addGitHubIntegration')}
          </h2>

          {/* gh repo picker — one-click add from the authenticated user's repos. */}
          <GitHubRepoPicker
            repos={repos}
            loadingRepos={loadingRepos}
            reposLoaded={reposLoaded}
            repoError={repoError}
            addedSet={addedSet}
            addingRepo={addingRepo}
            onReload={loadRepos}
            onAdd={addRepo}
          />

          {/* Divider between picker and manual entry */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('orAddManually')}</span>
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('repoUrl')}
              </label>
              <input
                type="text"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:border-indigo-400"
              />
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {changed ? tc('close') : tc('cancel')}
              </button>
              <button
                type="submit"
                disabled={saving || !repositoryUrl.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? t('adding') : tc('add')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

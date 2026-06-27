/**
 * useAddIntegration
 *
 * Owns the add-integration modal's state: the gh repo picker (fetch/add) and the
 * manual URL form submission. Holds no rendering concerns.
 */
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import type { AvailableRepo } from '../_components/github-dashboard.types';

/** Props for {@link useAddIntegration}. */
interface UseAddIntegrationParams {
  /** Invoked after a successful add to refresh the parent. / 追加成功後に親を更新するため呼ぶ。 */
  onSuccess: () => void;
  /** Invoked to close the modal with no changes. / 変更なしでモーダルを閉じる。 */
  onClose: () => void;
}

/**
 * Provide the add-integration modal's data and handlers.
 *
 * @param params - Close/success callbacks owned by the parent. / 親が持つ閉じる/成功コールバック。
 * @returns Picker state, manual-form state, and their handlers. / ピッカー状態・手動フォーム状態とハンドラ。
 */
export function useAddIntegration({ onSuccess, onClose }: UseAddIntegrationParams) {
  const t = useTranslations('github');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // gh repo picker state
  const [repos, setRepos] = useState<AvailableRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set());
  const [addingRepo, setAddingRepo] = useState<string | null>(null);
  // True once any repo was added via the picker; closing then refreshes the list.
  const [changed, setChanged] = useState(false);

  const loadRepos = async () => {
    setLoadingRepos(true);
    setRepoError('');
    try {
      const res = await fetch(`${API_BASE_URL}/github/available-repos?limit=100`);
      if (res.ok) {
        setRepos(await res.json());
        setReposLoaded(true);
      } else {
        setRepoError(t('repoListFailed'));
      }
    } catch {
      setRepoError(t('repoListFailed'));
    } finally {
      setLoadingRepos(false);
    }
  };

  // Auto-fetch the repo list when the modal opens so it appears without a click.
  useEffect(() => {
    loadRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRepo = async (repo: AvailableRepo) => {
    setAddingRepo(repo.nameWithOwner);
    setRepoError('');
    try {
      const res = await fetch(`${API_BASE_URL}/github/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryUrl: repo.url,
          ownerName: repo.owner,
          repositoryName: repo.name,
        }),
      });
      if (res.ok) {
        setAddedSet((prev) => new Set(prev).add(repo.nameWithOwner));
        setChanged(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setRepoError(data.error || t('addFailed'));
      }
    } catch {
      setRepoError(t('addFailed'));
    } finally {
      setAddingRepo(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Extract owner/repo from URL
    const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      setError(t('invalidRepoUrl'));
      return;
    }

    const [, ownerName, repositoryName] = match;
    const cleanRepoName = repositoryName.replace(/\.git$/, '');

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/github/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryUrl: `https://github.com/${ownerName}/${cleanRepoName}`,
          ownerName,
          repositoryName: cleanRepoName,
        }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || t('addFailed'));
      }
    } catch {
      setError(t('addFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Closing after a picker add must refresh the parent so new integrations show.
  const handleClose = () => (changed ? onSuccess() : onClose());

  return {
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
  };
}

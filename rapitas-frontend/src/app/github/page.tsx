'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  GitBranch,
  GitPullRequest,
  CircleDot,
  Plus,
  RefreshCw,
  Settings,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import type {
  GitHubIntegration,
  GitHubPullRequest,
  GitHubIssue,
} from '@/types';
import { getLabelsArray } from '@/utils/labels';
import { API_BASE_URL } from '@/utils/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function GitHubPage() {
  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [ghStatus, setGhStatus] = useState<{
    ghAvailable: boolean;
    authenticated: boolean;
  } | null>(null);
  const [recentPRs, setRecentPRs] = useState<GitHubPullRequest[]>([]);
  const [recentIssues, setRecentIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statusRes, integrationsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/github/status`),
        fetch(`${API_BASE_URL}/github/integrations`),
      ]);

      if (statusRes.ok) {
        setGhStatus(await statusRes.json());
      }

      if (integrationsRes.ok) {
        const data = await integrationsRes.json();
        setIntegrations(data);

        // 最初の連携のPRとIssueを取得
        if (data.length > 0) {
          const [prsRes, issuesRes] = await Promise.all([
            fetch(
              `${API_BASE_URL}/github/integrations/${data[0].id}/pull-requests?state=open`,
            ),
            fetch(
              `${API_BASE_URL}/github/integrations/${data[0].id}/issues?state=open`,
            ),
          ]);

          if (prsRes.ok) setRecentPRs(await prsRes.json());
          if (issuesRes.ok) setRecentIssues(await issuesRes.json());
        }
      }
    } catch (error) {
      console.error('Failed to fetch GitHub data:', error);
    } finally {
      setLoading(false);
    }
  };

  const syncIntegration = async (id: number) => {
    setSyncing(id);
    try {
      await Promise.all([
        fetch(`${API_BASE_URL}/github/integrations/${id}/sync-prs`, {
          method: 'POST',
        }),
        fetch(`${API_BASE_URL}/github/integrations/${id}/sync-issues`, {
          method: 'POST',
        }),
      ]);
      await fetchData();
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(null);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              GitHub連携
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1">
              リポジトリの管理、PR/Issueの同期
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            連携を追加
          </button>
        </div>

        {/* GitHub CLI ステータス */}
        {ghStatus && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              ghStatus.authenticated
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
            }`}
          >
            <div className="flex items-center gap-3">
              {ghStatus.authenticated ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <span className="text-green-700 dark:text-green-300">
                    GitHub CLI 認証済み
                  </span>
                </>
              ) : ghStatus.ghAvailable ? (
                <>
                  <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                  <span className="text-yellow-700 dark:text-yellow-300">
                    GitHub CLI は利用可能ですが、認証されていません。`gh auth
                    login` を実行してください。
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  <span className="text-red-700 dark:text-red-300">
                    GitHub CLI がインストールされていません。
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* 連携一覧 */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            連携リポジトリ
          </h2>
          {integrations.length === 0 ? (
            <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
              <GitBranch className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
              <p className="text-zinc-500 dark:text-zinc-400">
                連携されたリポジトリがありません
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                リポジトリを追加
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {integrations.map((integration) => (
                <div
                  key={integration.id}
                  className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                        {integration.ownerName}/{integration.repositoryName}
                      </h3>
                      <a
                        href={integration.repositoryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        GitHubで開く
                      </a>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => syncIntegration(integration.id)}
                        disabled={syncing === integration.id}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                        title="同期"
                      >
                        <RefreshCw
                          className={`w-4 h-4 ${syncing === integration.id ? 'animate-spin' : ''}`}
                        />
                      </button>
                      <Link
                        href={`/github/integrations/${integration.id}/settings`}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                        title="設定"
                      >
                        <Settings className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <Link
                      href={`/github/pull-requests?integrationId=${integration.id}`}
                      className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <GitPullRequest className="w-4 h-4" />
                      <span>{integration._count?.pullRequests || 0} PR</span>
                    </Link>
                    <Link
                      href={`/github/issues?integrationId=${integration.id}`}
                      className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <CircleDot className="w-4 h-4" />
                      <span>{integration._count?.issues || 0} Issues</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 最近のPR */}
        {recentPRs.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                最近のPull Request
              </h2>
              <Link
                href="/github/pull-requests"
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                すべて見る
              </Link>
            </div>
            <div className="space-y-2">
              {recentPRs.slice(0, 5).map((pr) => (
                <Link
                  key={pr.id}
                  href={`/github/pull-requests/${pr.id}`}
                  className="flex items-center gap-4 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors"
                >
                  <GitPullRequest
                    className={`w-5 h-5 ${
                      pr.state === 'open'
                        ? 'text-green-500'
                        : pr.state === 'merged'
                          ? 'text-purple-500'
                          : 'text-red-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      #{pr.prNumber} {pr.title}
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {pr.authorLogin} • {pr.headBranch} → {pr.baseBranch}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      pr.state === 'open'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : pr.state === 'merged'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}
                  >
                    {pr.state}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 最近のIssue */}
        {recentIssues.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                最近のIssue
              </h2>
              <Link
                href="/github/issues"
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                すべて見る
              </Link>
            </div>
            <div className="space-y-2">
              {recentIssues.slice(0, 5).map((issue) => (
                <Link
                  key={issue.id}
                  href={`/github/issues/${issue.id}`}
                  className="flex items-center gap-4 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors"
                >
                  <CircleDot
                    className={`w-5 h-5 ${
                      issue.state === 'open'
                        ? 'text-green-500'
                        : 'text-purple-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      #{issue.issueNumber} {issue.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {issue.authorLogin}
                      </span>
                      {getLabelsArray(issue.labels)
                        .slice(0, 3)
                        .map((label) => (
                          <span
                            key={label}
                            className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded"
                          >
                            {label}
                          </span>
                        ))}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      issue.state === 'open'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                    }`}
                  >
                    {issue.state}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 連携追加モーダル */}
        {showAddModal && (
          <AddIntegrationModal
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false);
              fetchData();
            }}
          />
        )}
      </div>
    </div>
  );
}

function AddIntegrationModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // URLからowner/repoを抽出
    const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      setError('有効なGitHubリポジトリURLを入力してください');
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
        setError(data.error || '連携の追加に失敗しました');
      }
    } catch {
      setError('連携の追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-lg shadow-xl">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            GitHub連携を追加
          </h2>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                リポジトリURL
              </label>
              <input
                type="text"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-4">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? '追加中...' : '追加'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

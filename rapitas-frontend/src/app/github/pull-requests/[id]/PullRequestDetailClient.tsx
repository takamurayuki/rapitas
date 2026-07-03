'use client';

/**
 * PullRequestDetailClient
 *
 * Page-level client component for the pull request detail view.
 * Manages data fetching, tab state, and interaction handlers,
 * delegating all rendering to sub-components.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { MessageSquare, FileCode, GitMerge, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GitHubPullRequest, FileDiff } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { PRDetailSkeleton } from './components/PRDetailSkeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { createLogger } from '@/lib/logger';

type MergeMethod = 'merge' | 'squash' | 'rebase';
import { PRHeader } from './components/PRHeader';
import { PRConversationTab } from './components/PRConversationTab';
import { PRFilesTab } from './components/PRFilesTab';
import { PRSidebar } from './components/PRSidebar';

const logger = createLogger('PullRequestDetailClient');

export default function PullRequestDetailClient() {
  const t = useTranslations('github');
  const params = useParams();
  const id = params.id as string;

  const [pr, setPr] = useState<GitHubPullRequest | null>(null);
  const [diff, setDiff] = useState<FileDiff[]>([]);
  const [activeTab, setActiveTab] = useState<'conversation' | 'files'>('conversation');
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [reviewAction, setReviewAction] = useState<'approve' | 'request_changes' | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [branches, setBranches] = useState<string[]>([]);
  const [themeDefaultBranch, setThemeDefaultBranch] = useState<string | null>(null);
  const [changingBase, setChangingBase] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [resolvingConflicts, setResolvingConflicts] = useState(false);
  const { showToast } = useToast();

  const fetchPRData = useCallback(async () => {
    setLoading(true);
    try {
      const [prRes, diffRes] = await Promise.all([
        fetch(`${API_BASE_URL}/github/pull-requests/${id}`),
        fetch(`${API_BASE_URL}/github/pull-requests/${id}/diff`),
      ]);

      if (prRes.ok) {
        setPr(await prRes.json());
      }
      if (diffRes.ok) {
        setDiff(await diffRes.json());
      }
    } catch (error) {
      logger.error('Failed to fetch PR:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchPRData();
  }, [fetchPRData]);

  // Load the repo's branches so the user can change the merge target branch.
  const repositoryUrl = pr?.integration?.repositoryUrl;
  useEffect(() => {
    if (!repositoryUrl) return;
    fetch(`${API_BASE_URL}/themes/branches?repositoryUrl=${encodeURIComponent(repositoryUrl)}`)
      .then((res) => (res.ok ? res.json() : { branches: [] }))
      .then((data: { branches?: string[] }) => setBranches(data.branches ?? []))
      .catch(() => setBranches([]));
  }, [repositoryUrl]);

  // Resolve the linked task's theme default branch so the configured merge
  // target is always offered — when the integration has no repositoryUrl the
  // remote branch fetch above is skipped, otherwise the dropdown would only show
  // the generic develop/main/master lines.
  const linkedTaskId = pr?.linkedTaskId;
  useEffect(() => {
    if (!linkedTaskId) return;
    fetch(`${API_BASE_URL}/tasks/${linkedTaskId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            task?: { theme?: { defaultBranch?: string | null } };
            theme?: { defaultBranch?: string | null };
          } | null,
        ) => {
          // The task endpoint may wrap the row in { task } or return it directly.
          const dflt = data?.task?.theme?.defaultBranch ?? data?.theme?.defaultBranch;
          if (dflt) setThemeDefaultBranch(dflt);
        },
      )
      .catch(() => setThemeDefaultBranch(null));
  }, [linkedTaskId]);

  const handleChangeBase = async (baseBranch: string) => {
    if (!pr || baseBranch === pr.baseBranch) return;
    setChangingBase(true);
    try {
      const res = await fetch(`${API_BASE_URL}/github/pull-requests/${id}/base`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseBranch }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        showToast(t('pullRequestDetail.baseChanged', { baseBranch }), 'success');
        await fetchPRData();
      } else {
        showToast(data.error || t('pullRequestDetail.baseChangeFailed'), 'error');
      }
    } catch (error) {
      logger.error('Failed to change base branch:', error);
      showToast(t('pullRequestDetail.baseChangeFailed'), 'error');
    } finally {
      setChangingBase(false);
    }
  };

  const handleComment = async () => {
    if (!commentBody.trim()) return;

    setCommenting(true);
    try {
      await fetch(`${API_BASE_URL}/github/pull-requests/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody }),
      });
      setCommentBody('');
      await fetchPRData();
    } catch (error) {
      logger.error('Failed to comment:', error);
    } finally {
      setCommenting(false);
    }
  };

  const handleReview = async (action: 'approve' | 'request_changes') => {
    setReviewAction(action);
    try {
      const endpoint = action === 'approve' ? 'approve' : 'request-changes';
      await fetch(`${API_BASE_URL}/github/pull-requests/${id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody || undefined }),
      });
      setCommentBody('');
      await fetchPRData();
    } catch (error) {
      logger.error('Failed to review:', error);
    } finally {
      setReviewAction(null);
    }
  };

  const handleResolveConflicts = async () => {
    if (!pr) return;
    setResolvingConflicts(true);
    try {
      const res = await fetch(`${API_BASE_URL}/github/pull-requests/${id}/resolve-conflicts`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.resolved) {
        showToast(data.detail || t('pullRequestDetail.baseSynced'), 'success');
        await fetchPRData();
      } else if (res.ok && data.taskId) {
        showToast(
          t('pullRequestDetail.conflictTaskCreated', {
            count: data.conflicts?.length ?? 0,
            taskId: data.taskId,
          }),
          'success',
        );
      } else {
        showToast(
          data.error || data.detail || t('pullRequestDetail.resolveConflictsFailed'),
          'error',
        );
      }
    } catch (error) {
      logger.error('Failed to resolve conflicts:', error);
      showToast(t('pullRequestDetail.resolveConflictsFailed'), 'error');
    } finally {
      setResolvingConflicts(false);
    }
  };

  const handleMerge = async () => {
    if (!pr) return;
    setMerging(true);
    try {
      const res = await fetch(`${API_BASE_URL}/github/pull-requests/${id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: mergeMethod, deleteBranch, auto: autoMerge }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.autoQueued) {
          showToast(t('pullRequestDetail.autoMergeQueued'), 'success');
          await fetchPRData();
          return;
        }
        showToast(t('pullRequestDetail.merged', { prNumber: pr.prNumber }), 'success');
        // Report the local base-branch sync outcome (best-effort on the server).
        if (data.localSync?.synced) {
          showToast(data.localSync.detail, 'success');
        } else if (data.localSync && !data.localSync.synced) {
          showToast(
            t('pullRequestDetail.localSyncFailed', { detail: data.localSync.detail }),
            'error',
          );
        }
        await fetchPRData();
      } else {
        showToast(data.error || t('pullRequestDetail.mergeFailed'), 'error');
      }
    } catch (error) {
      logger.error('Failed to merge:', error);
      showToast(t('pullRequestDetail.mergeFailed'), 'error');
    } finally {
      setMerging(false);
    }
  };

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filename)) {
        newSet.delete(filename);
      } else {
        newSet.add(filename);
      }
      return newSet;
    });
  };

  if (loading) {
    return <PRDetailSkeleton />;
  }

  if (!pr) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-center text-zinc-500 dark:text-zinc-400">{t('prNotFound')}</p>
      </div>
    );
  }

  const conversationCount = (pr.reviews?.length || 0) + (pr.comments?.length || 0);

  // Always offer a usable base-branch list. When the repo's branch fetch is
  // empty/slow the selector previously showed ONLY the current base (a dead
  // dropdown). Union the fetched branches with the current base and the common
  // lines (develop/main/master), excluding the PR's own head branch.
  const baseOptions = Array.from(
    new Set<string>(
      [themeDefaultBranch, ...branches, pr.baseBranch, 'develop', 'main', 'master'].filter(
        (b): b is string => !!b,
      ),
    ),
  ).filter((b) => b !== pr.headBranch);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PRHeader pr={pr} />

      {/* Merge bar — only for open PRs. Review the diff/approve first, then merge. */}
      {pr.state === 'open' && (
        <div className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('pullRequestDetail.mergeTargetLabel')}
          </span>
          <select
            value={pr.baseBranch}
            onChange={(e) => handleChangeBase(e.target.value)}
            disabled={changingBase}
            className="px-3 py-1.5 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm disabled:opacity-50"
          >
            {baseOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {changingBase && <Spinner size="sm" />}
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('pullRequestDetail.mergeMethodLabel')}
          </span>
          <select
            value={mergeMethod}
            onChange={(e) => setMergeMethod(e.target.value as MergeMethod)}
            className="px-3 py-1.5 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm"
          >
            <option value="squash">Squash and merge</option>
            <option value="merge">Create a merge commit</option>
            <option value="rebase">Rebase and merge</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
              className="rounded"
            />
            {t('pullRequestDetail.deleteBranchLabel')}
          </label>
          <label
            className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400"
            title={t('pullRequestDetail.autoMergeTooltip')}
          >
            <input
              type="checkbox"
              checked={autoMerge}
              onChange={(e) => setAutoMerge(e.target.checked)}
              className="rounded"
            />
            {t('pullRequestDetail.autoMergeLabel')}
          </label>
          <button
            onClick={handleResolveConflicts}
            disabled={resolvingConflicts}
            title={t('pullRequestDetail.resolveConflictsTooltip')}
            className="ml-auto flex items-center gap-2 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 text-sm font-medium rounded-lg transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50"
          >
            {resolvingConflicts ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitMerge className="w-4 h-4" />
            )}
            {t('pullRequestDetail.resolveConflictsButton')}
          </button>
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {merging ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitMerge className="w-4 h-4" />
            )}
            {t('pullRequestDetail.mergeButton')}
          </button>
        </div>
      )}

      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-700 mb-6">
        <button
          onClick={() => setActiveTab('conversation')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'conversation'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            {t('conversation')}
            {conversationCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 rounded">
                {conversationCount}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'files'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4" />
            {t('filesChanged')}
            {diff.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 rounded">
                {diff.length}
              </span>
            )}
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {activeTab === 'conversation' ? (
            <PRConversationTab
              pr={pr}
              commentBody={commentBody}
              commenting={commenting}
              reviewAction={reviewAction}
              onCommentChange={setCommentBody}
              onComment={handleComment}
              onReview={handleReview}
            />
          ) : (
            <PRFilesTab diff={diff} expandedFiles={expandedFiles} onToggleFile={toggleFile} />
          )}
        </div>

        <PRSidebar pr={pr} diff={diff} />
      </div>
    </div>
  );
}

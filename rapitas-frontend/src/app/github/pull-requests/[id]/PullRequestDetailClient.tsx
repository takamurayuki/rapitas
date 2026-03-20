'use client';

/**
 * PullRequestDetailClient
 *
 * Page-level client component for the pull request detail view.
 * Manages data fetching, tab state, and interaction handlers,
 * delegating all rendering to sub-components.
 */

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { MessageSquare, FileCode } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GitHubPullRequest, FileDiff } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { createLogger } from '@/lib/logger';
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
  const [activeTab, setActiveTab] = useState<'conversation' | 'files'>(
    'conversation',
  );
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [reviewAction, setReviewAction] = useState<
    'approve' | 'request_changes' | null
  >(null);

  useEffect(() => {
    fetchPRData();
  }, [id]);

  const fetchPRData = async () => {
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
    return <LoadingSpinner />;
  }

  if (!pr) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-center text-zinc-500 dark:text-zinc-400">
          {t('prNotFound')}
        </p>
      </div>
    );
  }

  const conversationCount =
    (pr.reviews?.length || 0) + (pr.comments?.length || 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PRHeader pr={pr} />

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
            <PRFilesTab
              diff={diff}
              expandedFiles={expandedFiles}
              onToggleFile={toggleFile}
            />
          )}
        </div>

        <PRSidebar pr={pr} diff={diff} />
      </div>
    </div>
  );
}

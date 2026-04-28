'use client';

/**
 * PRConversationTab
 *
 * Conversation tab content for the pull request detail page.
 * Renders the PR body, reviews, comments, and the comment/review input form.
 */

import { MessageSquare, CheckCircle2, AlertCircle, Send, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GitHubPullRequest } from '@/types';
import { getReviewIcon } from './PrUtils';

interface PRConversationTabProps {
  pr: GitHubPullRequest;
  commentBody: string;
  commenting: boolean;
  reviewAction: 'approve' | 'request_changes' | null;
  onCommentChange: (value: string) => void;
  onComment: () => void;
  onReview: (action: 'approve' | 'request_changes') => void;
}

/**
 * Renders the conversation tab including reviews, comments, and the reply form.
 *
 * @param props - PRConversationTabProps
 */
export function PRConversationTab({
  pr,
  commentBody,
  commenting,
  reviewAction,
  onCommentChange,
  onComment,
  onReview,
}: PRConversationTabProps) {
  const t = useTranslations('github');

  return (
    <div className="space-y-4">
      {pr.body && (
        <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="prose dark:prose-invert max-w-none text-sm">{pr.body}</div>
        </div>
      )}

      {pr.reviews?.map((review) => (
        <div
          key={review.id}
          className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
        >
          <div className="flex items-center gap-2 mb-2">
            {getReviewIcon(review.state)}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {review.authorLogin}
            </span>
            <span
              className={`px-2 py-0.5 text-xs rounded ${
                review.state === 'APPROVED'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : review.state === 'CHANGES_REQUESTED'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'
              }`}
            >
              {review.state === 'APPROVED'
                ? 'Approved'
                : review.state === 'CHANGES_REQUESTED'
                  ? 'Changes requested'
                  : 'Commented'}
            </span>
            <span className="text-xs text-zinc-400">
              {new Date(review.submittedAt).toLocaleString('ja-JP')}
            </span>
          </div>
          {review.body && <p className="text-sm text-zinc-600 dark:text-zinc-400">{review.body}</p>}
        </div>
      ))}

      {pr.comments?.map((comment) => (
        <div
          key={comment.id}
          className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
        >
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-zinc-400" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {comment.authorLogin}
            </span>
            {comment.path && (
              <span className="text-xs font-mono bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
                {comment.path}:{comment.line}
              </span>
            )}
            <span className="text-xs text-zinc-400">
              {new Date(comment.createdAt).toLocaleString('ja-JP')}
            </span>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{comment.body}</p>
        </div>
      ))}

      {/* Comment / review input form */}
      <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <textarea
          value={commentBody}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder={t('commentPlaceholder')}
          rows={3}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            {pr.state === 'open' && (
              <>
                <button
                  onClick={() => onReview('approve')}
                  disabled={reviewAction !== null}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {t('approve')}
                </button>
                <button
                  onClick={() => onReview('request_changes')}
                  disabled={reviewAction !== null || !commentBody.trim()}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  <AlertCircle className="w-4 h-4" />
                  {t('requestChanges')}
                </button>
              </>
            )}
          </div>
          <button
            onClick={onComment}
            disabled={commenting || !commentBody.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {commenting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {t('comment')}
          </button>
        </div>
      </div>
    </div>
  );
}

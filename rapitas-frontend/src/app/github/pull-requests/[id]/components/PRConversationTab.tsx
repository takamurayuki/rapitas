'use client';

/**
 * PRConversationTab
 *
 * Conversation tab content for the pull request detail page.
 * Renders the PR body, reviews, comments, and the comment/review input form.
 * Each body card is collapsed by default and toggled via a chevron button.
 */

import { useState, type ReactNode } from 'react';
import {
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Send,
  Loader2,
  ChevronDown,
  FileText,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GitHubPullRequest } from '@/types';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { getReviewIcon } from './PrUtils';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

interface PRConversationTabProps {
  pr: GitHubPullRequest;
  commentBody: string;
  commenting: boolean;
  reviewAction: 'approve' | 'request_changes' | null;
  onCommentChange: (value: string) => void;
  onComment: () => void;
  onReview: (action: 'approve' | 'request_changes') => void;
}

/** Collapsible card — header always visible, body toggled by chevron. */
function CollapsibleCard({ header, children }: { header: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">{header}</div>
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-700/60 pt-3">
          {children}
        </div>
      )}
    </div>
  );
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
  const locale = useLocaleStore((s) => s.locale);

  return (
    <div className="space-y-2">
      {pr.body && (
        <CollapsibleCard
          header={
            <>
              <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                PR Description
              </span>
            </>
          }
        >
          <MarkdownView content={pr.body} />
        </CollapsibleCard>
      )}

      {pr.reviews?.map((review) => (
        <CollapsibleCard
          key={review.id}
          header={
            <>
              {getReviewIcon(review.state)}
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {review.authorLogin}
              </span>
              <span
                className={`px-2 py-0.5 text-xs rounded flex-shrink-0 ${
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
              <span className="text-xs text-zinc-400 flex-shrink-0">
                {new Date(review.submittedAt).toLocaleString(toDateLocale(locale))}
              </span>
            </>
          }
        >
          {review.body ? (
            <MarkdownView content={review.body} />
          ) : (
            <p className="text-sm text-zinc-400 italic">No comment body.</p>
          )}
        </CollapsibleCard>
      ))}

      {pr.comments?.map((comment) => (
        <CollapsibleCard
          key={comment.id}
          header={
            <>
              <MessageSquare className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {comment.authorLogin}
              </span>
              {comment.path && (
                <span className="text-xs font-mono bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded flex-shrink-0">
                  {comment.path}:{comment.line}
                </span>
              )}
              <span className="text-xs text-zinc-400 flex-shrink-0">
                {new Date(comment.createdAt).toLocaleString(toDateLocale(locale))}
              </span>
            </>
          }
        >
          <MarkdownView content={comment.body} />
        </CollapsibleCard>
      ))}

      {/* Comment / review input form */}
      <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <textarea
          value={commentBody}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder={t('commentPlaceholder')}
          rows={3}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:border-indigo-400 resize-none"
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

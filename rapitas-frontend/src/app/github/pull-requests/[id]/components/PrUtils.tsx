/**
 * prUtils
 *
 * Shared icon helper functions for the pull request detail components.
 * Returns JSX elements — kept here to avoid duplicating icon logic across sub-components.
 */

import { GitPullRequest, GitMerge, XCircle, CheckCircle2, AlertCircle, MessageSquare } from 'lucide-react';

/**
 * Returns an icon element that represents the PR's open/merged/closed state.
 *
 * @param state - PR state string from GitHub API / GitHub APIのPR状態文字列
 * @returns A colored icon element / 色付きアイコン要素
 */
export function getPRStatusIcon(state: string) {
  switch (state) {
    case 'open':
      return <GitPullRequest className="w-6 h-6 text-green-500" />;
    case 'merged':
      return <GitMerge className="w-6 h-6 text-purple-500" />;
    case 'closed':
      return <XCircle className="w-6 h-6 text-red-500" />;
    default:
      return <GitPullRequest className="w-6 h-6" />;
  }
}

/**
 * Returns a small icon element that represents a review's approval state.
 *
 * @param state - Review state string from GitHub API / GitHub APIのレビュー状態文字列
 * @returns A colored icon element / 色付きアイコン要素
 */
export function getReviewIcon(state: string) {
  switch (state) {
    case 'APPROVED':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'CHANGES_REQUESTED':
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    default:
      return <MessageSquare className="w-4 h-4 text-zinc-400" />;
  }
}

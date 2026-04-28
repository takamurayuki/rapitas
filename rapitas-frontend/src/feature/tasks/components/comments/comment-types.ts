/**
 * commentTypes
 *
 * Shared type definitions for the CommentsSection feature.
 * Does not import any React or runtime dependencies.
 */

import type { Comment } from '@/types';

export type CommentLink = {
  id: number;
  direction: 'outgoing' | 'incoming';
  label?: string | null;
  linkedComment: { id: number; content: string; taskId: number };
};

export type NoteData = Comment & {
  time: string;
  replies?: NoteData[];
  links?: CommentLink[];
};

/**
 * Converts a relative timestamp to a human-readable Japanese string.
 *
 * @param d - Date to format / フォーマットする日時
 * @returns Japanese relative time string / 相対時間の日本語文字列
 */
export const timeAgo = (d: Date): string => {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return '今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}日前`;
  return `${Math.floor(days / 30)}ヶ月前`;
};

export const LABEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  関連: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
  },
  発展: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  補足: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
  },
};

export const DEFAULT_LINK_STYLE = {
  bg: 'bg-blue-50 dark:bg-blue-900/20',
  text: 'text-blue-600 dark:text-blue-400',
  border: 'border-blue-200 dark:border-blue-800',
};

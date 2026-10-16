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

/** Translator shape accepted by timeAgo. */
type TFunc = (key: string, values?: Record<string, number | string>) => string;

/**
 * Converts a relative timestamp to a human-readable string.
 *
 * @param d - Date to format / フォーマットする日時
 * @param t - Translator bound to the `task` namespace / `task` 名前空間の翻訳関数
 * @returns Relative time string / 相対時間文字列
 */
export const timeAgo = (d: Date, t: TFunc): string => {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return t('time.now');
  if (m < 60) return t('time.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('time.hoursAgo', { count: h });
  const days = Math.floor(h / 24);
  if (days < 30) return t('time.daysAgo', { count: days });
  return t('time.monthsAgo', { count: Math.floor(days / 30) });
};

// NOTE: Keyed by the PERSISTED CommentLink.label value (sent to/stored by the
// backend) — these Japanese keys must stay stable. Their translated display
// text lives at task.linkLabels.{related,expansion,supplement} and is
// resolved via getLinkLabelDisplay() below, never by translating the key.
export const LABEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  関連: {
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    text: 'text-indigo-600 dark:text-indigo-400',
    border: 'border-indigo-200 dark:border-indigo-800',
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

/** Maps a persisted LABEL_COLORS key to its translated display i18n key. */
const LINK_LABEL_DISPLAY_KEYS: Record<string, string> = {
  関連: 'linkLabels.related',
  発展: 'linkLabels.expansion',
  補足: 'linkLabels.supplement',
};

/**
 * Resolves the translated display text for a persisted comment-link label.
 * Falls back to the raw stored value when it isn't one of the known labels.
 *
 * @param t - Translator bound to the `task` namespace / `task` 名前空間の翻訳関数
 * @param label - Persisted CommentLink.label value / 保存されているリンクラベル値
 * @returns Translated display string / 表示用の翻訳済み文字列
 */
export const getLinkLabelDisplay = (t: TFunc, label: string): string => {
  const key = LINK_LABEL_DISPLAY_KEYS[label];
  return key ? t(key) : label;
};

export const DEFAULT_LINK_STYLE = {
  bg: 'bg-indigo-50 dark:bg-indigo-900/20',
  text: 'text-indigo-600 dark:text-indigo-400',
  border: 'border-indigo-200 dark:border-indigo-800',
};

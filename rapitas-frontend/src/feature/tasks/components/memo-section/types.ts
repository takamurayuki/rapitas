/**
 * MemoSection types
 *
 * Shared type definitions and configuration constants for the MemoSection feature.
 * Does not contain runtime logic or React components.
 */

import {
  Clock,
  Lightbulb,
  AlertTriangle,
  CheckCircle,
  MessageSquare,
} from 'lucide-react';
import type { Comment } from '@/types';

export type MemoType = 'work-log' | 'idea' | 'issue' | 'solution' | 'general';

export type TaskActivity = {
  id: string;
  type:
    | 'status_change'
    | 'assignment'
    | 'priority_change'
    | 'description_update'
    | 'label_change';
  action: string;
  details?: string;
  user?: string;
  timestamp: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
};

export type MemoAnalysis = {
  summary: string;
  importance: 'low' | 'medium' | 'high';
  keywords: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  actionItems: string[];
  analyzedAt: string;
};

export type NoteData = Comment & {
  time: string;
  replies?: NoteData[];
  memoType?: MemoType;
  isPinned?: boolean;
  analysis?: MemoAnalysis;
  showAnalysis?: boolean;
};

export type MemoTemplate = {
  id: string;
  label: string;
  content: string;
  type: MemoType;
  description: string;
};

export type Props = {
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  taskId: number;
  onNewCommentChange: (v: string) => void;
  onAddComment: (
    content?: string,
    parentId?: number,
  ) => Promise<number | undefined> | void;
  onUpdateComment: (id: number, content: string) => Promise<void>;
  onDeleteComment: (id: number) => void;
};

export const MEMO_TEMPLATES: MemoTemplate[] = [
  {
    id: 'work-start',
    label: '作業開始',
    content:
      '## 作業開始\n\n**目標:**\n- \n\n**作業内容:**\n- \n\n**注意事項:**\n- ',
    type: 'work-log',
    description: '作業開始時の記録用テンプレート',
  },
  {
    id: 'work-end',
    label: '作業終了',
    content:
      '## 作業終了\n\n**完了項目:**\n- \n\n**進捗状況:**\n- \n\n**次回作業:**\n- \n\n**気づき:**\n- ',
    type: 'work-log',
    description: '作業終了時の振り返り用テンプレート',
  },
  {
    id: 'issue-report',
    label: '課題報告',
    content:
      '## 課題報告\n\n**問題:**\n\n\n**発生条件:**\n- \n\n**影響範囲:**\n- \n\n**緊急度:** [高/中/低]\n\n**対応方針:**\n- ',
    type: 'issue',
    description: '課題や問題の報告用テンプレート',
  },
  {
    id: 'solution',
    label: '解決策',
    content:
      '## 解決策\n\n**対象課題:**\n\n\n**解決方法:**\n\n\n**実装手順:**\n1. \n2. \n3. \n\n**検証方法:**\n- \n\n**リスク:**\n- ',
    type: 'solution',
    description: '解決策の提案用テンプレート',
  },
  {
    id: 'idea',
    label: 'アイデア',
    content:
      '## アイデア\n\n**概要:**\n\n\n**メリット:**\n- \n\n**実現可能性:** [高/中/低]\n\n**必要リソース:**\n- \n\n**次のステップ:**\n- ',
    type: 'idea',
    description: '新しいアイデアの整理用テンプレート',
  },
  {
    id: 'meeting-notes',
    label: '会議メモ',
    content:
      '## 会議メモ\n\n**日時:** \n**参加者:** \n\n**議題:**\n- \n\n**決定事項:**\n- \n\n**アクションアイテム:**\n- [ ] \n- [ ] \n\n**次回予定:**\n',
    type: 'general',
    description: '会議や打ち合わせの記録用テンプレート',
  },
];

export const MEMO_TYPE_CONFIG: Record<
  MemoType,
  {
    label: string;
    icon: React.ElementType;
    color: { bg: string; text: string; border: string; badge: string };
  }
> = {
  'work-log': {
    label: '作業ログ',
    icon: Clock,
    color: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200 dark:border-blue-800',
      badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400',
    },
  },
  idea: {
    label: 'アイデア',
    icon: Lightbulb,
    color: {
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200 dark:border-amber-800',
      badge:
        'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
    },
  },
  issue: {
    label: '課題',
    icon: AlertTriangle,
    color: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      text: 'text-red-600 dark:text-red-400',
      border: 'border-red-200 dark:border-red-800',
      badge: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
    },
  },
  solution: {
    label: '解決策',
    icon: CheckCircle,
    color: {
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      text: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-200 dark:border-emerald-800',
      badge:
        'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
    },
  },
  general: {
    label: '一般',
    icon: MessageSquare,
    color: {
      bg: 'bg-zinc-50 dark:bg-zinc-800/50',
      text: 'text-zinc-600 dark:text-zinc-400',
      border: 'border-zinc-200 dark:border-zinc-700',
      badge: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
    },
  },
};

/**
 * MemoSection types
 *
 * Shared type definitions and configuration constants for the MemoSection feature.
 * Does not contain runtime logic or React components.
 */

import { Clock, Lightbulb, AlertTriangle, CheckCircle, MessageSquare } from 'lucide-react';
import type { Comment } from '@/types';

export type MemoType = 'work-log' | 'idea' | 'issue' | 'solution' | 'general';

export type TaskActivity = {
  id: string;
  type: 'status_change' | 'assignment' | 'priority_change' | 'description_update' | 'label_change';
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

// NOTE: label/content/description are i18n keys into the `task` namespace,
// not display strings — resolve via t(key) at render time (see
// TemplateSelector.tsx / useMemoSection.ts).
export type MemoTemplate = {
  id: string;
  labelKey: string;
  contentKey: string;
  type: MemoType;
  descriptionKey: string;
};

export type Props = {
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  taskId: number;
  onNewCommentChange: (v: string) => void;
  onAddComment: (content?: string, parentId?: number) => Promise<number | undefined> | void;
  onUpdateComment: (id: number, content: string) => Promise<void>;
  onDeleteComment: (id: number) => void;
};

export const MEMO_TEMPLATES: MemoTemplate[] = [
  {
    id: 'work-start',
    labelKey: 'memoTemplates.workStart.label',
    contentKey: 'memoTemplates.workStart.content',
    type: 'work-log',
    descriptionKey: 'memoTemplates.workStart.description',
  },
  {
    id: 'work-end',
    labelKey: 'memoTemplates.workEnd.label',
    contentKey: 'memoTemplates.workEnd.content',
    type: 'work-log',
    descriptionKey: 'memoTemplates.workEnd.description',
  },
  {
    id: 'issue-report',
    labelKey: 'memoTemplates.issueReport.label',
    contentKey: 'memoTemplates.issueReport.content',
    type: 'issue',
    descriptionKey: 'memoTemplates.issueReport.description',
  },
  {
    id: 'solution',
    labelKey: 'memoTemplates.solution.label',
    contentKey: 'memoTemplates.solution.content',
    type: 'solution',
    descriptionKey: 'memoTemplates.solution.description',
  },
  {
    id: 'idea',
    labelKey: 'memoTemplates.idea.label',
    contentKey: 'memoTemplates.idea.content',
    type: 'idea',
    descriptionKey: 'memoTemplates.idea.description',
  },
  {
    id: 'meeting-notes',
    labelKey: 'memoTemplates.meetingNotes.label',
    contentKey: 'memoTemplates.meetingNotes.content',
    type: 'general',
    descriptionKey: 'memoTemplates.meetingNotes.description',
  },
];

// NOTE: labelKey is an i18n key into the `task` namespace — resolve via
// t(config.labelKey) at render time rather than reading a `.label` field.
export const MEMO_TYPE_CONFIG: Record<
  MemoType,
  {
    labelKey: string;
    icon: React.ElementType;
    color: { bg: string; text: string; border: string; badge: string };
  }
> = {
  'work-log': {
    labelKey: 'memoTypes.workLog',
    icon: Clock,
    color: {
      bg: 'bg-indigo-50 dark:bg-indigo-900/20',
      text: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-200 dark:border-indigo-800',
      badge: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400',
    },
  },
  idea: {
    labelKey: 'memoTypes.idea',
    icon: Lightbulb,
    color: {
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200 dark:border-amber-800',
      badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
    },
  },
  issue: {
    labelKey: 'memoTypes.issue',
    icon: AlertTriangle,
    color: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      text: 'text-red-600 dark:text-red-400',
      border: 'border-red-200 dark:border-red-800',
      badge: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
    },
  },
  solution: {
    labelKey: 'memoTypes.solution',
    icon: CheckCircle,
    color: {
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      text: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-200 dark:border-emerald-800',
      badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
    },
  },
  general: {
    labelKey: 'memoTypes.general',
    icon: MessageSquare,
    color: {
      bg: 'bg-zinc-50 dark:bg-zinc-800/50',
      text: 'text-zinc-600 dark:text-zinc-400',
      border: 'border-zinc-200 dark:border-zinc-700',
      badge: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
    },
  },
};

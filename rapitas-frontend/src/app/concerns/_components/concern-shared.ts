/**
 * concern-shared
 *
 * Shared types and display metadata for the 懸念バックログ (Concern Backlog) UI.
 * Imported by ConcernsClient (filters / add form) and ConcernCard (rendering).
 */

import { Bug, Wrench, ShieldAlert, Gauge, CircleDot } from 'lucide-react';

export type ConcernType = 'bug' | 'refactor' | 'security' | 'perf' | 'other';
export type ConcernSeverity = 'urgent' | 'high' | 'medium' | 'low';
export type ConcernStatus = 'open' | 'task_created' | 'dismissed' | 'resolved';

/** GitHub issue a concern was published to / imported from. */
export interface LinkedIssueRef {
  id: number;
  issueNumber: number;
  url: string;
  /** "open" | "closed" */
  state: string;
}

export interface Concern {
  id: number;
  title: string;
  detail: string;
  type: ConcernType;
  severity: ConcernSeverity;
  location: string | null;
  status: ConcernStatus;
  originTaskId: number | null;
  createdTaskId: number | null;
  themeId: number | null;
  createdAt: string;
  linkedIssue?: LinkedIssueRef | null;
}

/** Minimal GitHub integration shape used by the publish picker. */
export interface GhIntegration {
  id: number;
  ownerName: string;
  repositoryName: string;
}

export const TYPE_META: Record<ConcernType, { label: string; icon: typeof Bug; badge: string }> = {
  bug: {
    label: 'バグ',
    icon: Bug,
    badge: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
  },
  refactor: {
    label: 'リファクタ',
    icon: Wrench,
    badge: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300',
  },
  security: {
    label: 'セキュリティ',
    icon: ShieldAlert,
    badge: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
  },
  perf: {
    label: 'パフォーマンス',
    icon: Gauge,
    badge: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
  },
  other: {
    label: 'その他',
    icon: CircleDot,
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
};
export const TYPE_ORDER: ConcernType[] = ['bug', 'refactor', 'security', 'perf', 'other'];

export const SEVERITY_META: Record<
  ConcernSeverity,
  { label: string; badge: string; active: string }
> = {
  urgent: {
    label: '緊急',
    badge:
      'bg-red-100 text-red-700 ring-1 ring-red-300 dark:bg-red-900/40 dark:text-red-300 dark:ring-red-700',
    active: 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  },
  high: {
    label: '高',
    badge:
      'bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800',
    active: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  medium: {
    label: '中',
    badge:
      'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
    active: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  low: {
    label: '低',
    badge:
      'bg-sky-50 text-sky-600 ring-1 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800',
    active: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
};
export const SEVERITY_ORDER: ConcernSeverity[] = ['urgent', 'high', 'medium', 'low'];
/** Severity = how serious / urgent the concern is. Shown via PriorityIcon. */
export const SEVERITY_HINT: Record<ConcernSeverity, string> = {
  urgent: '緊急 — 早急に対処すべき',
  high: '高 — 影響が大きい',
  medium: '中 — 着実に対処したい',
  low: '低 — あれば直したい',
};

export const STATUS_TABS: { value: ConcernStatus | 'all'; label: string }[] = [
  { value: 'open', label: '未対応' },
  { value: 'task_created', label: 'タスク化済' },
  { value: 'all', label: 'すべて' },
];

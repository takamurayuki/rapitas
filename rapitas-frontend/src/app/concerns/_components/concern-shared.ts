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

// NOTE: `label` text moved to i18n (concerns.type*); TYPE_LABEL_KEY maps a type
// to its message key so callers can `t(TYPE_LABEL_KEY[type])`.
export const TYPE_META: Record<ConcernType, { icon: typeof Bug; badge: string }> = {
  bug: {
    icon: Bug,
    badge: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
  },
  refactor: {
    icon: Wrench,
    badge: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300',
  },
  security: {
    icon: ShieldAlert,
    badge: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
  },
  perf: {
    icon: Gauge,
    badge: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
  },
  other: {
    icon: CircleDot,
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
};
export const TYPE_ORDER: ConcernType[] = ['bug', 'refactor', 'security', 'perf', 'other'];
export const TYPE_LABEL_KEY: Record<ConcernType, string> = {
  bug: 'typeBug',
  refactor: 'typeRefactor',
  security: 'typeSecurity',
  perf: 'typePerf',
  other: 'typeOther',
};

// NOTE: `label` text moved to i18n (concerns.severity*); SEVERITY_LABEL_KEY maps
// a severity to its message key so callers can `t(SEVERITY_LABEL_KEY[severity])`.
export const SEVERITY_META: Record<ConcernSeverity, { badge: string; active: string }> = {
  urgent: {
    badge:
      'bg-red-100 text-red-700 ring-1 ring-red-300 dark:bg-red-900/40 dark:text-red-300 dark:ring-red-700',
    active: 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  },
  high: {
    badge:
      'bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800',
    active: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  medium: {
    badge:
      'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
    active: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  low: {
    badge:
      'bg-sky-50 text-sky-600 ring-1 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800',
    active: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
};
export const SEVERITY_ORDER: ConcernSeverity[] = ['urgent', 'high', 'medium', 'low'];
export const SEVERITY_LABEL_KEY: Record<ConcernSeverity, string> = {
  urgent: 'severityUrgent',
  high: 'severityHigh',
  medium: 'severityMedium',
  low: 'severityLow',
};
/** Severity = how serious / urgent the concern is. Shown via PriorityIcon. Message key under concerns.severityHint.*. */
export const SEVERITY_HINT_KEY: Record<ConcernSeverity, string> = {
  urgent: 'severityHint.urgent',
  high: 'severityHint.high',
  medium: 'severityHint.medium',
  low: 'severityHint.low',
};

export const STATUS_TABS: { value: ConcernStatus | 'all'; labelKey: string }[] = [
  { value: 'open', labelKey: 'statusOpen' },
  { value: 'task_created', labelKey: 'statusTaskCreated' },
  { value: 'all', labelKey: 'statusAll' },
];

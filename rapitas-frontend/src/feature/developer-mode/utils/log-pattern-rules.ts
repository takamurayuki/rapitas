/**
 * log-pattern-rules
 *
 * Public type definitions for the log transformer feature. Pattern rules
 * are in log-patterns-table.ts; transform functions are in log-transformers.ts.
 */

export type UserFriendlyLogCategory =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'progress'
  | 'phase-transition'
  | 'tool-result'
  | 'agent-text'
  | 'hidden';

export interface UserFriendlyLogEntry {
  category: UserFriendlyLogCategory;
  message: string;
  detail?: string;
  iconName?: string;
  phase?: 'research' | 'plan' | 'implement' | 'verify';
  /**
   * Number of consecutive identical raw entries merged into this one
   * (rendered as a ×N badge). Absent means 1.
   */
  count?: number;
  /**
   * How `detail` should render when expanded: 'markdown' gets the shared
   * formatted markdown preview; absent renders as plain preformatted text.
   */
  detailFormat?: 'markdown';
  /**
   * When set, the row shows a copy-to-clipboard button (right edge) that
   * copies this text (e.g. the working-directory path).
   */
  copyText?: string;
}

/** Translator function shape accepted by the log-classification pipeline. */
export type LogTranslate = (key: string, params?: Record<string, string | number>) => string;

export interface ExecutionSummary {
  filesEdited: string[];
  filesCreated: string[];
  filesRead: string[];
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  commits: number;
  errors: string[];
  durationSeconds?: number;
  costUsd?: number;
}

// Re-export patterns so log-transformers can import from one place
export { getLogPatterns, HIDDEN_PATTERNS } from './log-patterns';

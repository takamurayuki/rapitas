/**
 * deviation-timeline.types
 *
 * Response shapes of the plan-deviation API (task #1218), mirroring
 * rapitas-backend/services/workflow/plan-deviation/types.ts.
 */

/** Category of one timeline entry. */
export type DeviationEntryCategory =
  | 'in_plan'
  | 'out_of_plan'
  | 'planned_not_executed'
  | 'pending'
  | 'skipped';

/** Operation axis judged against the plan declaration. */
export type DeviationOperationKind = 'file_change' | 'command' | 'http';

/** Overall status of a timeline response. */
export type DeviationTimelineStatus = 'ok' | 'ambiguous' | 'no_operations' | 'unsupported_provider';

/** One classified entry (display strings are masked server-side). */
export interface DeviationEntry {
  category: DeviationEntryCategory;
  kind: DeviationOperationKind;
  seq?: number;
  occurredAt?: string;
  tool?: string;
  display: string;
  logSequence?: number;
  declaredItem?: string;
}

/** Counts per category. */
export interface DeviationCounts {
  inPlan: number;
  outOfPlan: number;
  plannedNotExecuted: number;
}

/** GET /workflow/tasks/:taskId/deviation-timeline response. */
export interface DeviationTimelineResponse {
  status: DeviationTimelineStatus;
  entries: DeviationEntry[];
  counts: DeviationCounts | null;
  byKind: Record<DeviationOperationKind, number> | null;
  warnings: string[];
  planHash: string | null;
  executionId: number | null;
}

/** One line of GET /workflow/executions/:id/deviation-context. */
export interface DeviationContextLine {
  sequenceNumber: number;
  text: string;
  isTarget: boolean;
}

/** Reviewer decision sent to POST /workflow/tasks/:taskId/deviation-audit. */
export type DeviationDecision = 'approved' | 'rejected';

/**
 * plan-deviation/types
 *
 * Shared types for the plan-vs-execution deviation timeline: the structured
 * plan declaration, recorded operations, classified timeline entries and the
 * approval-time audit record. Types and constants only — no logic.
 */

/** The three categories the acceptance criteria require every entry to fall into. */
export const DEVIATION_CATEGORIES = ['in_plan', 'out_of_plan', 'planned_not_executed'] as const;

/** One of 計画内 / 計画外 / 計画にあるが未実行. */
export type DeviationCategory = (typeof DEVIATION_CATEGORIES)[number];

/**
 * Category of a timeline entry. Besides the three deviation categories:
 * `pending` = declared but not executed YET (execution still running — not
 * counted), `skipped` = command op while the plan declared no commands (that
 * axis is not judged).
 */
export type EntryCategory = DeviationCategory | 'pending' | 'skipped';

/** Operation axes judged against the declaration. */
export type OperationKind = 'file_change' | 'command' | 'http';

/** Machine-readable plan declaration (the `json:plan-declaration` fence in plan.md). */
export interface PlanDeclaration {
  version: 1;
  /** Glob / directory patterns of files the plan will add or modify. */
  files: string[];
  /** Command names (arguments are ignored by design). */
  commands: string[];
  /** Hosts the plan will contact over HTTP (`*.example.com` allows subdomains). */
  externalHosts: string[];
}

/** Result of parsing plan.md for a declaration. */
export interface ParsedDeclaration {
  declaration: PlanDeclaration;
  /** Where the declaration came from. */
  source: 'fence' | 'fallback' | 'none';
  /** True when no file pattern is declared — the plan must not be used for judging. */
  ambiguous: boolean;
  /** Human-readable parse warnings (e.g. broken JSON fence). */
  warnings: string[];
}

/** Judging features extracted from the RAW tool input at record time. */
export interface OperationFeatures {
  path?: string;
  commandNames?: string[];
  hosts?: string[];
}

/** One persisted operation (one NDJSON line). */
export interface OperationRecord {
  seq: number;
  occurredAt: string;
  kind: OperationKind;
  tool: string;
  features: OperationFeatures;
  /** Display string, masked BEFORE it is written. */
  displayMasked: string;
  /** AgentExecutionLog.sequenceNumber of the log chunk that announced this tool call. */
  logSequence?: number;
}

/** One classified timeline entry. */
export interface TimelineEntry {
  category: EntryCategory;
  kind: OperationKind;
  /** Operation sequence (absent for declared-but-unexecuted items). */
  seq?: number;
  occurredAt?: string;
  tool?: string;
  display: string;
  logSequence?: number;
  /** Declared item an unexecuted entry refers to. */
  declaredItem?: string;
}

/** Counts per deviation category. */
export interface DeviationCounts {
  inPlan: number;
  outOfPlan: number;
  plannedNotExecuted: number;
}

/** Deviation count (out_of_plan + planned_not_executed) per operation kind. */
export type DeviationByKind = Record<OperationKind, number>;

/** Overall status of a timeline response. */
export type TimelineStatus = 'ok' | 'ambiguous' | 'no_operations' | 'unsupported_provider';

/** Classified timeline. counts/byKind are null whenever the plan was not used for judging. */
export interface DeviationTimeline {
  status: TimelineStatus;
  entries: TimelineEntry[];
  counts: DeviationCounts | null;
  byKind: DeviationByKind | null;
  warnings: string[];
  /** Short hash identifying the declaration the timeline was judged against. */
  planHash: string | null;
}

/** Approval decision recorded in an audit entry. */
export type AuditDecision = 'approved' | 'rejected';

/** Session audit record saved at approval time (one NDJSON line). */
export interface DeviationAuditRecord {
  taskId: number;
  executionId: number | null;
  decision: AuditDecision;
  status: TimelineStatus;
  counts: DeviationCounts | null;
  byKind: DeviationByKind | null;
  ambiguous: boolean;
  commentMasked: string | null;
  planHash: string | null;
  source: string;
  recordedAt: string;
}

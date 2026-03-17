/**
 * SafetyTypes
 *
 * Shared type definitions for the parallel execution safety system.
 * Not responsible for any runtime logic — purely declarative.
 */

/** Describes a single file modification detected in a worktree. */
export type FileModification = {
  filePath: string;
  taskId: number;
  agentId: string;
  timestamp: Date;
  /** git diff status character: A (added), M (modified), D (deleted), R (renamed) */
  changeType: 'A' | 'M' | 'D' | 'R';
};

/** Represents a file being concurrently modified by multiple tasks. */
export type FileConflict = {
  filePath: string;
  involvedTasks: number[];
  /** critical = same lines touched; warning = same file touched */
  severity: 'critical' | 'warning';
  detectedAt: Date;
};

/** Configuration for the real-time conflict detector polling loop. */
export type ConflictDetectorConfig = {
  enabled: boolean;
  pollingIntervalMs: number;
  /** When true, emit a pause request on critical conflicts. */
  pauseOnCritical: boolean;
};

/** Information about a single merge conflict found during trial merge. */
export type MergeConflictInfo = {
  filePath: string;
  branches: string[];
  conflictType: 'content' | 'rename' | 'delete_modify';
  conflictMarkers?: string;
};

/** Result of attempting to merge all task branches into a temporary worktree. */
export type TrialMergeResult = {
  success: boolean;
  conflicts: MergeConflictInfo[];
  mergedBranches: string[];
  failedBranches: string[];
};

/** A potential regression risk detected by pattern analysis across branches. */
export type RegressionRisk = {
  type: 'duplicate_function' | 'api_route_conflict' | 'type_conflict' | 'import_conflict';
  description: string;
  files: string[];
  taskIds: number[];
  severity: 'critical' | 'warning' | 'info';
};

/** Aggregated safety report for a parallel execution session. */
export type SafetyReport = {
  sessionId: string;
  generatedAt: Date;
  trialMerge: TrialMergeResult;
  regressionRisks: RegressionRisk[];
  fileConflicts: FileConflict[];
  /** Human-readable recommendation: 'safe_to_merge' | 'review_needed' | 'conflicts_detected' */
  recommendation: 'safe_to_merge' | 'review_needed' | 'conflicts_detected';
};

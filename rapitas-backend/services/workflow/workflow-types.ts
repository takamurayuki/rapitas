/**
 * Workflow Types
 *
 * Shared TypeScript type aliases and interfaces used across workflow
 * orchestration modules. SSOT for WorkflowRole/WorkflowStatus/WorkflowMode types,
 * runtime arrays, type guards, and narrowing functions. All consumers must
 * import from here.
 */

/**
 * Runtime array of all valid workflow roles. Derive WorkflowRole from this
 * so the type and the runtime list can never drift apart.
 */
export const WORKFLOW_ROLES = [
  'researcher',
  'planner',
  'reviewer',
  'implementer',
  'verifier',
  'auto_verifier',
] as const;

export type WorkflowRole = (typeof WORKFLOW_ROLES)[number];

/**
 * Runtime array of all valid workflow file types. Derive WorkflowFileType from this
 * so the type and the runtime validation list can never drift apart.
 */
export const WORKFLOW_FILE_TYPES = ['research', 'question', 'plan', 'verify'] as const;

export type WorkflowFileType = (typeof WORKFLOW_FILE_TYPES)[number];

/**
 * Runtime array of all valid workflow statuses. Derive WorkflowStatus from this
 * so the type and the runtime validation list can never drift apart.
 * NOTE: `awaiting_question` は question.md 保存後のユーザー回答待ち過渡状態。
 * 直前の status を記憶して回答後に戻すことで再実行を継続させる。
 */
export const WORKFLOW_STATUSES = [
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'awaiting_question',
  'verify_done',
  'completed',
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/**
 * `awaiting_question` の前段にあった status を保持する型。
 * 質問が解消された際にこの値へ戻す。
 */
export type ResumableWorkflowStatus = Exclude<
  WorkflowStatus,
  'awaiting_question' | 'completed' | 'verify_done'
>;

/**
 * Runtime array of all valid workflow modes. Derive WorkflowMode from this
 * so the type and the runtime validation list can never drift apart.
 */
export const WORKFLOW_MODES = ['lightweight', 'standard', 'comprehensive'] as const;

export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

/**
 * Type guard: narrows an unknown value to WorkflowStatus.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid WorkflowStatus. / 有効なWorkflowStatusの場合true
 */
export function isWorkflowStatus(s: unknown): s is WorkflowStatus {
  return typeof s === 'string' && (WORKFLOW_STATUSES as readonly string[]).includes(s);
}

/**
 * Type guard: narrows an unknown value to WorkflowMode.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid WorkflowMode. / 有効なWorkflowModeの場合true
 */
export function isWorkflowMode(s: unknown): s is WorkflowMode {
  return typeof s === 'string' && (WORKFLOW_MODES as readonly string[]).includes(s);
}

/**
 * Narrows a DB string (or null/undefined) to WorkflowStatus, returning a fallback
 * when the value is absent or unrecognised. Mirrors the existing `?? 'draft'` pattern
 * but with a compile-time-safe return type.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'draft'`. / 無効時に返す値（既定は'draft'）
 * @returns A valid WorkflowStatus. / 有効なWorkflowStatus
 */
export function narrowWorkflowStatus(
  s: string | null | undefined,
  fallback: WorkflowStatus = 'draft',
): WorkflowStatus {
  return isWorkflowStatus(s) ? s : fallback;
}

/**
 * Narrows a DB string (or null/undefined) to WorkflowMode, returning a fallback
 * when the value is absent or unrecognised. Mirrors the existing `?? 'comprehensive'`
 * pattern but with a compile-time-safe return type.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'comprehensive'`. / 無効時に返す値（既定は'comprehensive'）
 * @returns A valid WorkflowMode. / 有効なWorkflowMode
 */
export function narrowWorkflowMode(
  s: string | null | undefined,
  fallback: WorkflowMode = 'comprehensive',
): WorkflowMode {
  return isWorkflowMode(s) ? s : fallback;
}

/** Maps a workflow status to the role that should execute next and its expected output. */
export interface RoleTransition {
  role: WorkflowRole;
  /** null for the implementer role, which writes code rather than a workflow file */
  outputFile: WorkflowFileType | null;
  nextStatus: WorkflowStatus;
}

/** Return value of WorkflowOrchestrator.advanceWorkflow and the executor functions. */
export interface WorkflowAdvanceResult {
  success: boolean;
  role: WorkflowRole;
  status: WorkflowStatus;
  output?: string;
  error?: string;
  executionId?: number;
  /**
   * True when advanceWorkflow returned WITHOUT spawning an agent because
   * another phase was already executing for this task (the per-task mutex was
   * held). Callers must treat this as "still busy, retry later" — NOT a failure.
   * / 別フェーズ実行中のためエージェントを起動せず戻った場合に true。
   */
  skipped?: boolean;
}

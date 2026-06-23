/**
 * Workflow Types
 *
 * Shared TypeScript type aliases and interfaces used across workflow
 * orchestration modules. SSOT for WorkflowRole/WorkflowStatus/WorkflowMode types
 * and the WORKFLOW_ROLES runtime array. All consumers must import from here.
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

export type WorkflowFileType = 'research' | 'question' | 'plan' | 'verify';

export type WorkflowStatus =
  | 'draft'
  | 'research_done'
  | 'plan_created'
  | 'plan_approved'
  | 'in_progress'
  // NOTE: question.md が保存されてユーザー回答待ちの過渡状態。
  // 直前の status を記憶して、回答後に元 status に戻すことで再実行を継続させる。
  | 'awaiting_question'
  | 'verify_done'
  | 'completed';

/**
 * `awaiting_question` の前段にあった status を保持する型。
 * 質問が解消された際にこの値へ戻す。
 */
export type ResumableWorkflowStatus = Exclude<
  WorkflowStatus,
  'awaiting_question' | 'completed' | 'verify_done'
>;

export type WorkflowMode = 'lightweight' | 'standard' | 'comprehensive';

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

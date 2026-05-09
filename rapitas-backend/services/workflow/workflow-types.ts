/**
 * Workflow Types
 *
 * Shared TypeScript type aliases and interfaces used across workflow
 * orchestration modules. No runtime logic — types only.
 */

export type WorkflowRole =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier';

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
}

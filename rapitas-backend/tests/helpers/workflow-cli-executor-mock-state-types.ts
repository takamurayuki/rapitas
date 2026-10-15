/**
 * workflow-cli-executor-mock-state-types
 *
 * Structural types for the workflow-cli-executor shared mock state
 * (split from workflow-cli-executor-mock-state.ts). Type-only — no runtime
 * side effects.
 */

// ---------------------------------------------------------------------------
// Structural types (kept minimal — just enough for the executor's own usage,
// not a full mirror of the real Prisma payload types).
// ---------------------------------------------------------------------------

export interface TaskWithThemeLike {
  id: number;
  themeId: number | null;
  workflowStatus: string;
  theme: { workingDirectory: string | null; name: string } | null;
}

export interface TaskWorkflowStateLike {
  id: number;
  status: string;
  workflowStatus: string;
  workflowMode: string | null;
  parentId: number | null;
}

export interface LatestSessionWorktreeLike {
  worktreePath: string | null;
  branchName: string | null;
}

export interface ValidationResultLike {
  ok: boolean;
  missingSections: string[];
  severity: number;
  summary: string;
}

export interface CompletionGateResultLike {
  allow: boolean;
  reason: string;
}

export interface AutoCommitPRResultLike {
  requested?: { autoCommit: boolean; autoCreatePR: boolean; autoMergePR: boolean };
  autoPRResult?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
  error?: string;
}

export interface PlanAutoApproveResultLike {
  newStatus: 'plan_created' | 'plan_approved';
  autoApproved: boolean;
  reason?: string;
}

export interface ExecuteTaskResultLike {
  success: boolean;
  output: string;
  finalMessage?: string;
  errorMessage?: string;
}

export interface AgentTaskLike {
  id: number;
  title: string;
  description: string;
  workingDirectory: string;
}

export interface ExecutionOptionsLike {
  taskId: number;
  sessionId: number;
  agentConfigId: number;
  workingDirectory: string;
  modelIdOverride?: string;
  autoCompleteTask: boolean;
  investigationMode: boolean;
  investigationOutputType: string;
  outputLastMessageFile?: string;
}

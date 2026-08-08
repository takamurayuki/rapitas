/**
 * workflow-cli-executor-mock-state-fields
 *
 * Default factories + the mutable `wf` config object read live by the shared
 * mock functions (split from workflow-cli-executor-mock-state.ts). Not
 * responsible for spies or mock.module registration.
 */
import type {
  TaskWithThemeLike,
  TaskWorkflowStateLike,
  LatestSessionWorktreeLike,
  ValidationResultLike,
  CompletionGateResultLike,
  AutoCommitPRResultLike,
  PlanAutoApproveResultLike,
  ExecuteTaskResultLike,
  AgentTaskLike,
  ExecutionOptionsLike,
} from './workflow-cli-executor-mock-state-types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// NOTE: The three default factories below were file-private before the split;
// they are exported now only so resetWfMockState() (moved to the sibling
// -spies file) can keep calling them. They are not part of the public API
// surface tests rely on.
export function defaultTaskWithTheme(): TaskWithThemeLike {
  return {
    id: 1,
    themeId: 1,
    workflowStatus: 'draft',
    theme: { workingDirectory: '/fake/project', name: 'Test Theme' },
  };
}

export function defaultTaskWorkflowState(): TaskWorkflowStateLike {
  return {
    id: 1,
    status: 'in-progress',
    workflowStatus: 'draft',
    workflowMode: 'standard',
    parentId: null,
  };
}

export function defaultValidation(): ValidationResultLike {
  return { ok: true, missingSections: [], severity: 0, summary: 'ok' };
}

/** Mutable config knobs read live by the shared mock functions below. */
export const wf = {
  taskWithTheme: defaultTaskWithTheme() as TaskWithThemeLike | null,
  taskTitle: { id: 1, title: 'Test Task', description: null } as {
    id: number;
    title: string;
    description: string | null;
  } | null,
  taskWorkflowState: defaultTaskWorkflowState() as TaskWorkflowStateLike | null,
  latestSessionWorktree: null as LatestSessionWorktreeLike | null,
  canReuseWorktree: false,
  isBackendPrimaryCheckout: false,
  isPrimaryWorkTree: false,
  taskHasLinkedPrRow: null as { githubPrId: number | null } | null,
  linkedPrRow: null as { id: number } | null,

  createWorktreeImpl: (async () => '/fake/worktree/new') as (
    base: string,
    branch: string,
    taskId?: number,
    repositoryUrl?: string | null,
    baseBranch?: string | null,
  ) => Promise<string>,

  executeTaskImpl: (async () => ({ success: true, output: 'agent output' })) as (
    task: AgentTaskLike,
    options: ExecutionOptionsLike,
  ) => Promise<ExecuteTaskResultLike>,

  // Defaults to "not a git repo" — most tests never reach the git-root
  // fallback (they set theme.workingDirectory), so this default keeps that
  // rare branch deterministic without needing per-test control.
  gitRevParseImpl: (async () => {
    throw new Error('not a git repository');
  }) as () => Promise<{ stdout: string; stderr: string }>,

  readWorkflowFileImpl: (async () => null) as (
    taskId: number,
    fileType: string,
  ) => Promise<string | null>,
  extractMarkdownFromOutputImpl: ((_output: string, _fileType: string) => null) as (
    output: string,
    fileType: string,
  ) => string | null,

  validateResearch: defaultValidation(),
  validatePlan: defaultValidation(),
  validateVerify: defaultValidation(),

  evaluateCompletionGateImpl: (async () => ({ allow: true, reason: 'ok' })) as (
    worktreePath: string | null | undefined,
    verifyContent: string,
  ) => Promise<CompletionGateResultLike>,

  checkWorkflowInvariantsImpl: (async () => []) as (taskId: number) => Promise<unknown[]>,

  maybeAutoApprovePlanImpl: (async () => ({
    newStatus: 'plan_created' as const,
    autoApproved: false,
  })) as (taskId: number, language: 'ja' | 'en') => Promise<PlanAutoApproveResultLike>,

  generateFallbackBranchNameImpl: ((_title: string) => 'feature/fallback-branch') as (
    title: string,
  ) => string,

  // NOTE: Default mirrors the executor's OLD manual `-t${taskId}` suffixing so
  // workflow-cli-executor.worktree.test.ts's 'feature/fallback-branch-t1'
  // assertion holds unchanged — the marker now comes from inside
  // generateBranchName (task 539) rather than from the call site.
  generateBranchNameImpl: (async () => 'feature/fallback-branch-t1') as (
    title: string,
    description?: string,
    taskId?: number,
  ) => Promise<string>,

  applyResearchAssessedComplexityImpl: (async () => {}) as (
    taskId: number,
    content: string,
  ) => Promise<void>,

  performAutoCommitAndPRImpl: (async () => ({
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
    autoPRResult: { success: true, prUrl: 'https://example.com/pr/1', prNumber: 1 },
  })) as (taskId: number, verifyContent: string) => Promise<AutoCommitPRResultLike>,
};

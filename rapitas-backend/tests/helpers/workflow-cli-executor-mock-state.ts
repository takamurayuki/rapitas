/**
 * workflow-cli-executor-mock-state
 *
 * Shared mutable mock state + a single `installWorkflowCliExecutorMocks()`
 * entry point for the workflow-cli-executor split test suite
 * (services/workflow/workflow-cli-executor.*.test.ts).
 *
 * executeCLIAgent has ~17 direct/dynamic module dependencies. bun's
 * `mock.module` registry is process-global, and when several test FILES each
 * register their OWN factory for the same specifier, only the last-registered
 * factory is actually consulted once test bodies run (verified empirically:
 * running two pre-existing split suites — branch-pr-ops.test.ts and
 * branch-pr-ops-merge-revert.test.ts — together makes some of the first
 * file's tests silently exercise the second file's mocks instead of its own).
 * Every workflow-cli-executor split file therefore calls the exact same
 * `installWorkflowCliExecutorMocks()`, whose factories all read from the
 * mutable fields below. Whichever file's registration ends up "active" makes
 * no difference — behavior is always driven by whichever test most recently
 * mutated this shared state. Each split file MUST call `resetWfMockState()`
 * in its own `beforeEach` so state never leaks between files.
 */
import { mock } from 'bun:test';
import { join } from 'path';

// mock.module resolves relative specifiers relative to the file that CALLS
// it — not relative to the module under test. Since this helper lives at
// tests/helpers/ but registers mocks for workflow-cli-executor.ts's (in
// services/workflow/) dependencies, every specifier below is resolved to an
// ABSOLUTE path anchored on the backend root so registration lands on the
// exact same resolved module the SUT imports, regardless of which directory
// calls installWorkflowCliExecutorMocks().
const BACKEND_ROOT = join(import.meta.dir, '..', '..');
const p = (rel: string): string => join(BACKEND_ROOT, rel);

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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultTaskWithTheme(): TaskWithThemeLike {
  return {
    id: 1,
    themeId: 1,
    workflowStatus: 'draft',
    theme: { workingDirectory: '/fake/project', name: 'Test Theme' },
  };
}

function defaultTaskWorkflowState(): TaskWorkflowStateLike {
  return {
    id: 1,
    status: 'in-progress',
    workflowStatus: 'draft',
    workflowMode: 'standard',
    parentId: null,
  };
}

function defaultValidation(): ValidationResultLike {
  return { ok: true, missingSections: [], severity: 0, summary: 'ok' };
}

/** Mutable config knobs read live by the shared mock functions below. */
export const wf = {
  taskWithTheme: defaultTaskWithTheme() as TaskWithThemeLike | null,
  taskTitle: { id: 1, title: 'Test Task' } as { id: number; title: string } | null,
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
    dir: string,
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

  applyResearchAssessedComplexityImpl: (async () => {}) as (
    taskId: number,
    content: string,
  ) => Promise<void>,

  performAutoCommitAndPRImpl: (async () => ({
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
    autoPRResult: { success: true, prUrl: 'https://example.com/pr/1', prNumber: 1 },
  })) as (taskId: number, verifyContent: string) => Promise<AutoCommitPRResultLike>,
};

// ---------------------------------------------------------------------------
// Stable spies — the actual functions every mock.module factory exports.
// Declared once so `.mock.calls` assertions work no matter which file's
// registration is the "active" one for a given specifier.
// ---------------------------------------------------------------------------

export const spies = {
  resolveTaskWithTheme: mock(() => Promise.resolve(wf.taskWithTheme)),
  resolveTaskTitle: mock(() => Promise.resolve(wf.taskTitle)),
  resolveTaskWorkflowState: mock(() => Promise.resolve(wf.taskWorkflowState)),
  resolveLatestSessionWorktree: mock(() => Promise.resolve(wf.latestSessionWorktree)),
  canReuseWorktree: mock(() => wf.canReuseWorktree),
  isBackendPrimaryCheckout: mock(() => Promise.resolve(wf.isBackendPrimaryCheckout)),
  isPrimaryWorkTree: mock(() => Promise.resolve(wf.isPrimaryWorkTree)),
  createWorktree: mock(
    (
      base: string,
      branch: string,
      taskId?: number,
      repo?: string | null,
      baseBranch?: string | null,
    ) => wf.createWorktreeImpl(base, branch, taskId, repo, baseBranch),
  ),
  executeTask: mock((task: AgentTaskLike, options: ExecutionOptionsLike) =>
    wf.executeTaskImpl(task, options),
  ),
  readWorkflowFile: mock((dir: string, fileType: string) => wf.readWorkflowFileImpl(dir, fileType)),
  writeWorkflowFile: mock(() => Promise.resolve()),
  cleanupRootWorkflowFiles: mock(() => Promise.resolve()),
  extractMarkdownFromOutput: mock((output: string, fileType: string) =>
    wf.extractMarkdownFromOutputImpl(output, fileType),
  ),
  validateResearch: mock(() => wf.validateResearch),
  validatePlan: mock(() => wf.validatePlan),
  validateVerify: mock(() => wf.validateVerify),
  recordTransition: mock(() => Promise.resolve()),
  evaluateCompletionGate: mock((worktreePath: string | null | undefined, verifyContent: string) =>
    wf.evaluateCompletionGateImpl(worktreePath, verifyContent),
  ),
  writeBlockedStatusDurable: mock(() => Promise.resolve(true)),
  checkWorkflowInvariants: mock((taskId: number) => wf.checkWorkflowInvariantsImpl(taskId)),
  maybeAutoApprovePlan: mock((taskId: number, language: 'ja' | 'en') =>
    wf.maybeAutoApprovePlanImpl(taskId, language),
  ),
  generateFallbackBranchName: mock((title: string) => wf.generateFallbackBranchNameImpl(title)),
  applyResearchAssessedComplexity: mock((taskId: number, content: string) =>
    wf.applyResearchAssessedComplexityImpl(taskId, content),
  ),
  performAutoCommitAndPR: mock((taskId: number, verifyContent: string) =>
    wf.performAutoCommitAndPRImpl(taskId, verifyContent),
  ),
  appendEvent: mock(() => Promise.resolve()),
  gitExec: mock(() => wf.gitRevParseImpl()),

  // prisma
  taskUpdate: mock(() => Promise.resolve({})),
  taskFindUnique: mock(() => Promise.resolve(wf.taskHasLinkedPrRow)),
  agentSessionCreate: mock(() => Promise.resolve({ id: 100 })),
  gitHubPrFindFirst: mock(() => Promise.resolve(wf.linkedPrRow)),
  agentExecutionUpdateMany: mock(() => Promise.resolve({ count: 0 })),
  agentExecutionFindFirst: mock(() => Promise.resolve(null)),
};

/**
 * Restore every config field and clear every spy's call history. Every split
 * test file must call this in its own `beforeEach`.
 */
export function resetWfMockState(): void {
  wf.taskWithTheme = defaultTaskWithTheme();
  wf.taskTitle = { id: 1, title: 'Test Task' };
  wf.taskWorkflowState = defaultTaskWorkflowState();
  wf.latestSessionWorktree = null;
  wf.canReuseWorktree = false;
  wf.isBackendPrimaryCheckout = false;
  wf.isPrimaryWorkTree = false;
  wf.taskHasLinkedPrRow = null;
  wf.linkedPrRow = null;
  wf.createWorktreeImpl = async () => '/fake/worktree/new';
  wf.executeTaskImpl = async () => ({ success: true, output: 'agent output' });
  wf.gitRevParseImpl = async () => {
    throw new Error('not a git repository');
  };
  wf.readWorkflowFileImpl = async () => null;
  wf.extractMarkdownFromOutputImpl = () => null;
  wf.validateResearch = defaultValidation();
  wf.validatePlan = defaultValidation();
  wf.validateVerify = defaultValidation();
  wf.evaluateCompletionGateImpl = async () => ({ allow: true, reason: 'ok' });
  wf.checkWorkflowInvariantsImpl = async () => [];
  wf.maybeAutoApprovePlanImpl = async () => ({ newStatus: 'plan_created', autoApproved: false });
  wf.generateFallbackBranchNameImpl = () => 'feature/fallback-branch';
  wf.applyResearchAssessedComplexityImpl = async () => {};
  wf.performAutoCommitAndPRImpl = async () => ({
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
    autoPRResult: { success: true, prUrl: 'https://example.com/pr/1', prNumber: 1 },
  });

  for (const spy of Object.values(spies)) spy.mockClear();
}

/**
 * Register every mock.module override executeCLIAgent's module graph needs.
 * Idempotent-ish: safe to call from every split test file — later calls just
 * re-register equivalent factories (all delegating to the same `spies`
 * above), which is required so state control works regardless of which
 * file's registration bun keeps "active" (see file header).
 */
export function installWorkflowCliExecutorMocks(): void {
  mock.module(p('config/database'), () => ({
    prisma: prismaMock,
    ensureDatabaseConnection: () => Promise.resolve(),
  }));
  mock.module(p('config/logger'), () => ({
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '',
  }));
  mock.module(p('config'), () => ({
    prisma: prismaMock,
    ensureDatabaseConnection: () => Promise.resolve(),
    createLogger: () => noopLogger,
    logger: noopLogger,
    getDbProvider: () => 'postgresql',
    getInsensitiveMode: () => 'default',
    getProjectRoot: () => '/fake/rapitas',
  }));

  // fs/promises is intentionally left REAL (not mocked): executeCLIAgent only
  // calls `mkdir(workflowDir, { recursive: true })`, a harmless idempotent
  // call against the real filesystem. Mocking this specifier turned out to
  // intercept unrelated transitive imports of fs/promises elsewhere in the
  // process (e.g. `readdir`), causing "export not found" crashes — not worth
  // it for a single side-effect-free call. Tests pass a real OS temp dir as
  // `workflowDir`.

  const childProcessModule = () => ({
    exec: (cmd: string, optsOrCb: unknown, cb?: (err: Error | null, r?: unknown) => void) => {
      const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as (
        err: Error | null,
        r?: unknown,
      ) => void;
      spies
        .gitExec()
        .then((r) => callback(null, r))
        .catch((e: Error) => callback(e));
    },
    // Not used by executeCLIAgent itself, but other modules transitively
    // reachable in the bun test process (e.g. process-tracker utilities)
    // import these from the same specifier — mirror them so mocking
    // child_process here never breaks an unrelated import elsewhere.
    execFile: () => {},
    execSync: () => Buffer.from(''),
    spawn: () => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } }),
    spawnSync: () => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
    fork: () => ({ on: () => {} }),
  });
  mock.module('child_process', childProcessModule);
  mock.module('node:child_process', childProcessModule);

  mock.module(p('services/agents/agent-orchestrator'), () => ({
    AgentOrchestrator: {
      getInstance: () => ({
        createWorktree: spies.createWorktree,
        executeTask: spies.executeTask,
      }),
    },
    createOrchestrator: () => ({}),
  }));

  mock.module(p('services/task/task-resolver'), () => ({
    resolveTaskWithTheme: spies.resolveTaskWithTheme,
    resolveTaskTitle: spies.resolveTaskTitle,
    resolveTaskWorkflowState: spies.resolveTaskWorkflowState,
    resolveTaskWithThemeAndCategory: mock(() => Promise.resolve(null)),
    resolveTaskForExecution: mock(() => Promise.resolve(null)),
    resolveTaskWorkingDirectory: mock(() => Promise.resolve(null)),
    resolveTaskThemeId: mock(() => Promise.resolve(null)),
    resolveTaskForComplexityAnalysis: mock(() => Promise.resolve(null)),
    resolveTaskSubtaskInfo: mock(() => Promise.resolve(null)),
    resolveTaskForPlanApproval: mock(() => Promise.resolve(null)),
    resolveTaskForAutoMerge: mock(() => Promise.resolve(null)),
    resolveTaskForLearning: mock(() => Promise.resolve(null)),
  }));

  mock.module(p('services/agents/agent-session-resolver'), () => ({
    resolveLatestFinishedSession: mock(() => Promise.resolve(null)),
    resolveSessionWithLatestExecution: mock(() => Promise.resolve(null)),
    resolveLatestSessionWorktree: spies.resolveLatestSessionWorktree,
  }));

  mock.module(p('services/workflow/workflow-file-utils'), () => ({
    resolveWorkflowDir: mock(() =>
      Promise.resolve({ dir: '/fake/wf/1', taskId: 1, categoryId: 0, themeId: 1 }),
    ),
    deleteWorkflowDir: mock(() => Promise.resolve(true)),
    readWorkflowFile: spies.readWorkflowFile,
    writeWorkflowFile: spies.writeWorkflowFile,
    archiveWorkflowFile: mock(() => Promise.resolve(false)),
    cleanupRootWorkflowFiles: spies.cleanupRootWorkflowFiles,
    looksLikeAgentLog: mock(() => false),
    sliceFromReportHeading: mock((t: string) => t),
    extractMarkdownFromOutput: spies.extractMarkdownFromOutput,
  }));

  mock.module(p('services/workflow/phase-output-validator'), () => ({
    looksLogPolluted: mock(() => false),
    validateResearch: spies.validateResearch,
    validatePlan: spies.validatePlan,
    validateVerify: spies.validateVerify,
    isReusableArtifact: mock(() => false),
  }));

  mock.module(p('services/workflow/transition-recorder'), () => ({
    recordTransition: spies.recordTransition,
  }));

  mock.module(p('services/workflow/completion-gate'), () => ({
    verifyJustifiesNoChange: mock(() => false),
    researchConcludesNoChange: mock(() => false),
    evaluateCompletionGate: spies.evaluateCompletionGate,
  }));

  mock.module(p('services/workflow/durable-blocked-write'), () => ({
    writeBlockedStatusDurable: spies.writeBlockedStatusDurable,
  }));

  mock.module(p('services/workflow/workflow-invariants'), () => ({
    normalizeWorkflowStatus: mock((s: string) => s),
    requiredWorkflowFiles: mock(() => []),
    previewMissingFilesForStatus: mock(() => Promise.resolve([])),
    checkWorkflowInvariants: spies.checkWorkflowInvariants,
  }));

  mock.module(p('services/workflow/plan-auto-approve'), () => ({
    resolveEffectiveAutoApprovePlan: mock(() => Promise.resolve(false)),
    maybeAutoApprovePlan: spies.maybeAutoApprovePlan,
  }));

  mock.module(p('services/agents/orchestrator/git-operations/worktree-usable'), () => ({
    canReuseWorktree: spies.canReuseWorktree,
    decideWorktree: mock(() => 'recreate'),
  }));

  mock.module(p('services/agents/orchestrator/git-operations/worktree-guard'), () => ({
    isPrimaryWorkTree: spies.isPrimaryWorkTree,
    ensureNotPrimaryWorkTree: mock(() => Promise.resolve()),
    isBackendPrimaryCheckout: spies.isBackendPrimaryCheckout,
    findConflictingWorktreeForBranch: mock(() => Promise.resolve(null)),
  }));

  mock.module(p('utils/common/branch-name-generator'), () => ({
    generateBranchName: mock(() => Promise.resolve('feature/generated')),
    extractBranchName: mock((s: string) => s),
    sanitizeBranchName: mock((s: string) => s),
    assertSafeGitRef: mock(() => {}),
    isValidBranchName: mock(() => true),
    generateFallbackBranchName: spies.generateFallbackBranchName,
  }));

  mock.module(p('services/workflow/research-complexity'), () => ({
    parseResearchComplexity: mock(() => null),
    applyResearchAssessedComplexity: spies.applyResearchAssessedComplexity,
  }));

  mock.module(p('routes/workflow/workflow-auto-commit'), () => ({
    performAutoCommitAndPR: spies.performAutoCommitAndPR,
  }));

  mock.module(p('services/memory/timeline'), () => ({
    appendEvent: spies.appendEvent,
    queryEvents: mock(() => Promise.resolve([])),
  }));
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLogger,
};

const prismaMock = {
  task: { update: spies.taskUpdate, findUnique: spies.taskFindUnique },
  agentSession: { create: spies.agentSessionCreate },
  gitHubPullRequest: { findFirst: spies.gitHubPrFindFirst },
  agentExecution: {
    updateMany: spies.agentExecutionUpdateMany,
    findFirst: spies.agentExecutionFindFirst,
  },
};

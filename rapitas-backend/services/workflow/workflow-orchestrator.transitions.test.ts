/**
 * workflow-orchestrator.transitions.test
 *
 * Covers the status/artifact bookkeeping in WorkflowOrchestrator.runAdvanceWorkflow
 * that runs around agent dispatch:
 *   - draft-status reconciliation from existing research.md/plan.md rows (a
 *     re-dispatched task must not restart at 'draft' when artifacts already exist)
 *   - flipping a resumed 'todo' task to 'in-progress' without touching workflowStatus
 *   - the research/plan artifact-reuse skip-regeneration path
 *   - verify.md is NEVER reused, even when isReusableArtifact would say yes
 *
 * Model routing is kept out of scope: every agentConfig below has a concrete
 * modelId, so the Smart Router branch (`effectiveModelId is null/'auto'`) never
 * fires. See workflow-orchestrator.smart-router.test.ts for that path.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Test task',
    description: null,
    workflowStatus: 'draft',
    workflowMode: 'standard',
    workflowModeOverride: 'standard',
    status: 'in-progress',
    parentId: null,
    themeId: 1,
    complexityScore: 70,
    autoApprovePlan: false,
    estimatedHours: null,
    priority: null,
    labels: null,
    goals: null,
    constraints: null,
    acceptanceCriteria: null,
    theme: { id: 1, workingDirectory: '/tmp', category: { id: 1 } },
    ...overrides,
  };
}

function makeRoleConfig(overrides: Record<string, unknown> = {}) {
  return {
    role: 'researcher',
    isEnabled: true,
    systemPromptKey: null,
    modelId: null,
    agentConfigId: 1,
    agentConfig: {
      id: 1,
      agentType: 'claude-code',
      name: 'Test Agent',
      modelId: 'claude-haiku-4-5-20251001',
      apiKeyEncrypted: null,
      endpoint: null,
    },
    ...overrides,
  };
}

const taskFindUniqueMock = mock(() => Promise.resolve(makeTask()));
const taskUpdateMock = mock(() => Promise.resolve({}));
const roleConfigFindUniqueMock = mock(() => Promise.resolve(makeRoleConfig()));

let planFileExists = false;
let researchFileExists = false;
const workflowFileFindFirstMock = mock(
  (args: { where: { fileType: string } }): Promise<{ id: number } | null> => {
    if (args.where.fileType === 'plan') return Promise.resolve(planFileExists ? { id: 1 } : null);
    if (args.where.fileType === 'research')
      return Promise.resolve(researchFileExists ? { id: 2 } : null);
    return Promise.resolve(null);
  },
);

const mockPrisma = {
  task: { findUnique: taskFindUniqueMock, update: taskUpdateMock },
  workflowRoleConfig: { findUnique: roleConfigFindUniqueMock },
  systemPrompt: { findUnique: mock(() => Promise.resolve(null)) },
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
  workflowFile: { findFirst: workflowFileFindFirstMock },
};

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: noopLogger,
  createLogger: () => noopLogger,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => '/tmp/rapitas-test',
}));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

let existingArtifactContent: string | null = null;
let isReusableArtifactImpl: (outputFile: string) => boolean = () => false;
const readWorkflowFileMock = mock(() => Promise.resolve(existingArtifactContent));
mock.module('./workflow-file-utils', () => ({
  resolveWorkflowDir: mock(() =>
    Promise.resolve({ dir: '/tmp/wf/1', taskId: 1, categoryId: 0, themeId: 1 }),
  ),
  deleteWorkflowDir: mock(() => Promise.resolve(true)),
  readWorkflowFile: readWorkflowFileMock,
  writeWorkflowFile: mock(() => Promise.resolve()),
  archiveWorkflowFile: mock(() => Promise.resolve(false)),
  cleanupRootWorkflowFiles: mock(() => Promise.resolve()),
  looksLikeAgentLog: mock(() => false),
  sliceFromReportHeading: mock((text: string) => text),
  extractMarkdownFromOutput: mock(() => null),
}));
mock.module('./workflow-context-builder', () => ({
  buildRoleContext: mock(() => Promise.resolve('context')),
  researchModeDirective: mock(() => ''),
  applyPlanModeDirective: mock((_role: unknown, content: string) => content),
}));
const executeCLIAgentMock = mock(() =>
  Promise.resolve({ success: true, role: 'researcher', status: 'research_done' }),
);
mock.module('./workflow-agent-executor', () => ({
  executeCLIAgent: executeCLIAgentMock,
  executeAPIAgent: mock(() =>
    Promise.resolve({ success: true, role: 'researcher', status: 'research_done' }),
  ),
}));
mock.module('../agents/task-execution-lock', () => ({
  DEFAULT_LOCK_TTL_MS: 30 * 60 * 1000,
  WORKFLOW_LOCK_TTL_MS: 30 * 60 * 1000,
  acquireTaskExecutionLock: mock(() => true),
  releaseTaskExecutionLock: mock(() => {}),
  isTaskExecutionLocked: mock(() => true),
}));
mock.module('../../routes/ai/system-prompts/default-prompts', () => ({
  CORE_DEFAULT_PROMPTS: [],
  WORKFLOW_DEFAULT_PROMPTS: [],
  DEFAULT_SYSTEM_PROMPTS: [],
}));
mock.module('./phase-output-validator', () => ({
  looksLogPolluted: mock(() => false),
  validateResearch: mock(() => ({ ok: true })),
  validatePlan: mock(() => ({ ok: true })),
  validateVerify: mock(() => ({ ok: true })),
  isReusableArtifact: mock((outputFile: string) => isReusableArtifactImpl(outputFile)),
}));
mock.module('./transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));
mock.module('./workflow-mode-config', () => ({
  getModeSettings: mock(() =>
    Promise.resolve({ hasPlanPhase: true, hasReviewPhase: false, hasAutoVerify: false }),
  ),
  buildTransitions: mock(() => ({
    draft: { role: 'researcher', nextStatus: 'research_done', outputFile: 'research' },
    research_done: { role: 'planner', nextStatus: 'plan_created', outputFile: 'plan' },
    plan_approved: { role: 'implementer', nextStatus: 'verify_done', outputFile: 'verify' },
  })),
  selectProvisionalMode: mock(() => Promise.resolve('standard')),
}));
mock.module('../intake', () => ({
  ensureIntakeReady: mock(() => Promise.resolve({ status: 'ready' })),
  checkSpecQuality: mock(() => ({ thin: false })),
  parseSpecArray: mock(() => []),
  mergeSpecField: mock((v: unknown) => v),
  resolveIntakePolicy: mock(() => Promise.resolve({})),
  decideIntake: mock(() => ({ proceed: true })),
  buildIntakeQuestion: mock(() => ''),
}));
mock.module('./role-provider-resolver', () => ({
  inferProviderFromModelId: mock(() => 'claude'),
  resolveRoleProviderPreferences: mock(() => Promise.resolve({})),
}));
mock.module('../ai/agent-fallback', () => ({
  agentTypeToProvider: mock(() => 'claude'),
  providerToAgentTypes: mock(() => ['claude-code']),
  findAgentConfigForProvider: mock(() => Promise.resolve(null)),
  findFallbackAgentConfig: mock(() => Promise.resolve(null)),
}));

// Import AFTER all mock.module calls.
const { WorkflowOrchestrator } = await import('./workflow-orchestrator');

function resetSingleton() {
  (WorkflowOrchestrator as unknown as { instance: unknown }).instance = undefined;
}

describe('WorkflowOrchestrator — draft status reconciliation', () => {
  beforeEach(() => {
    resetSingleton();
    taskFindUniqueMock.mockClear();
    taskFindUniqueMock.mockImplementation(() => Promise.resolve(makeTask()));
    taskUpdateMock.mockClear();
    roleConfigFindUniqueMock.mockImplementation(() => Promise.resolve(makeRoleConfig()));
    executeCLIAgentMock.mockClear();
    isReusableArtifactImpl = () => false;
    existingArtifactContent = null;
    planFileExists = false;
    researchFileExists = false;
  });

  test('plan.md already exists -> reconciles straight to plan_approved', async () => {
    planFileExists = true;
    researchFileExists = true;

    const orchestrator = WorkflowOrchestrator.getInstance();
    await orchestrator.advanceWorkflow(1);

    const reconcileCall = taskUpdateMock.mock.calls.find(
      (c) => (c[0] as { data: { workflowStatus?: string } }).data.workflowStatus,
    );
    expect(reconcileCall).toBeDefined();
    const data = (reconcileCall?.[0] as { data: { workflowStatus: string; status: string } }).data;
    expect(data.workflowStatus).toBe('plan_approved');
    expect(data.status).toBe('in-progress');
  });

  test('only research.md exists -> reconciles to research_done', async () => {
    planFileExists = false;
    researchFileExists = true;

    const orchestrator = WorkflowOrchestrator.getInstance();
    await orchestrator.advanceWorkflow(1);

    const reconcileCall = taskUpdateMock.mock.calls.find(
      (c) => (c[0] as { data: { workflowStatus?: string } }).data.workflowStatus,
    );
    const data = (reconcileCall?.[0] as { data: { workflowStatus: string } }).data;
    expect(data.workflowStatus).toBe('research_done');
  });

  test('no artifacts on disk -> stays at draft', async () => {
    planFileExists = false;
    researchFileExists = false;

    const orchestrator = WorkflowOrchestrator.getInstance();
    await orchestrator.advanceWorkflow(1);

    const reconcileCall = taskUpdateMock.mock.calls.find(
      (c) => (c[0] as { data: { workflowStatus?: string } }).data.workflowStatus,
    );
    const data = (reconcileCall?.[0] as { data: { workflowStatus: string } }).data;
    expect(data.workflowStatus).toBe('draft');
  });
});

describe('WorkflowOrchestrator — resumed todo task', () => {
  beforeEach(() => {
    resetSingleton();
    taskFindUniqueMock.mockClear();
    taskUpdateMock.mockClear();
    roleConfigFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeRoleConfig({ role: 'planner' })),
    );
    executeCLIAgentMock.mockClear();
    isReusableArtifactImpl = () => false;
    existingArtifactContent = null;
  });

  test("status='todo' at a non-draft phase flips to in-progress without touching workflowStatus", async () => {
    taskFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeTask({ workflowStatus: 'research_done', status: 'todo' })),
    );

    const orchestrator = WorkflowOrchestrator.getInstance();
    await orchestrator.advanceWorkflow(1);

    const statusOnlyCall = taskUpdateMock.mock.calls.find((c) => {
      const data = (c[0] as { data: Record<string, unknown> }).data;
      return data.status === 'in-progress' && !('workflowStatus' in data);
    });
    expect(statusOnlyCall).toBeDefined();
  });

  test("status already 'in-progress' does not trigger a redundant status update", async () => {
    taskFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeTask({ workflowStatus: 'research_done', status: 'in-progress' })),
    );

    const orchestrator = WorkflowOrchestrator.getInstance();
    await orchestrator.advanceWorkflow(1);

    const statusOnlyCall = taskUpdateMock.mock.calls.find((c) => {
      const data = (c[0] as { data: Record<string, unknown> }).data;
      return data.status === 'in-progress' && !('workflowStatus' in data);
    });
    expect(statusOnlyCall).toBeUndefined();
  });
});

describe('WorkflowOrchestrator — artifact reuse', () => {
  beforeEach(() => {
    resetSingleton();
    taskFindUniqueMock.mockClear();
    taskUpdateMock.mockClear();
    executeCLIAgentMock.mockClear();
    existingArtifactContent = null;
    isReusableArtifactImpl = () => false;
  });

  test('a valid existing research.md skips regeneration and advances the status', async () => {
    taskFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeTask({ workflowStatus: 'draft' })),
    );
    roleConfigFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeRoleConfig({ role: 'researcher' })),
    );
    existingArtifactContent = '# Research\n\nSubstantive content.';
    isReusableArtifactImpl = () => true;

    const orchestrator = WorkflowOrchestrator.getInstance();
    const result = await orchestrator.advanceWorkflow(1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('research_done');
    expect(result.output).toContain('スキップ');
    expect(executeCLIAgentMock).not.toHaveBeenCalled();
  });

  test('a log-polluted research.md is NOT reused — the agent still runs', async () => {
    taskFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeTask({ workflowStatus: 'draft' })),
    );
    roleConfigFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeRoleConfig({ role: 'researcher' })),
    );
    existingArtifactContent = '[System: thinking_tokens]';
    isReusableArtifactImpl = () => false;

    const orchestrator = WorkflowOrchestrator.getInstance();
    await orchestrator.advanceWorkflow(1);

    expect(executeCLIAgentMock).toHaveBeenCalledTimes(1);
  });

  test('verify.md is never reused even when isReusableArtifact would approve it', async () => {
    taskFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeTask({ workflowStatus: 'plan_approved' })),
    );
    roleConfigFindUniqueMock.mockImplementation(() =>
      Promise.resolve(makeRoleConfig({ role: 'implementer' })),
    );
    // plan.md must look valid too, or the implementer plan-validity guard would fire first.
    existingArtifactContent = '# Plan\n\nvalid plan';
    isReusableArtifactImpl = () => true;

    const orchestrator = WorkflowOrchestrator.getInstance();
    await orchestrator.advanceWorkflow(1);

    // The reuse-skip branch is only for outputFile !== 'verify' — the agent must run.
    expect(executeCLIAgentMock).toHaveBeenCalledTimes(1);
  });
});

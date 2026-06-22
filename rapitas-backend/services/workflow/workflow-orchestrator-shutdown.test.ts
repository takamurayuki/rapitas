/**
 * workflow-orchestrator-shutdown.test
 *
 * Verifies that the catch block inside runAdvanceWorkflow (workflow-orchestrator.ts)
 * handles shutdown-caused interruptions correctly:
 *   - Shutdown error  → log.warn + return {success:false} (tryProviderFallback skipped)
 *   - Non-shutdown error → log.error + tryProviderFallback attempted
 *
 * Uses mock.module for the heavy infrastructure (prisma, agents, workflow utils)
 * so the test runs without a real database.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { buildShutdownErrorMessage } from '../agents/orchestrator/shutdown-error';

// ── Mocks ────────────────────────────────────────────────────────────────────

const warnMock = mock((..._args: unknown[]) => {});
const errorMock = mock((..._args: unknown[]) => {});
const loggerMock = { info: () => {}, warn: warnMock, error: errorMock, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
}));

// Controls what executeCLIAgent does for each test.
let executeCLIAgentImpl: () => Promise<unknown> = () =>
  Promise.resolve({ success: true, role: 'planner', status: 'plan_created' });

const executeCLIAgentMock = mock(
  (
    _taskId: unknown,
    _task: unknown,
    _cfg: unknown,
    _sys: unknown,
    _ctx: unknown,
    _transition: unknown,
    _dir: unknown,
    _lang: unknown,
    _advanceFn: unknown,
    _devCfg: unknown,
  ) => executeCLIAgentImpl(),
);

mock.module('./workflow-agent-executor', () => ({
  executeCLIAgent: executeCLIAgentMock,
  executeAPIAgent: mock(() =>
    Promise.resolve({ success: true, role: 'planner', status: 'plan_created' }),
  ),
}));

const mockPrisma = {
  task: {
    findUnique: mock(() =>
      Promise.resolve({
        id: 1,
        title: 'Test task',
        description: null,
        // NOTE: 'research_done' → 'planner' transition avoids the implementer plan-validity check
        // which would return early when plan.md is absent.
        workflowStatus: 'research_done',
        workflowMode: 'standard',
        workflowModeOverride: null,
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
      }),
    ),
    update: mock(() => Promise.resolve({})),
  },
  workflowRoleConfig: {
    findUnique: mock(() =>
      Promise.resolve({
        role: 'planner',
        isEnabled: true,
        systemPromptKey: null,
        modelId: null,
        agentConfigId: 1,
        agentConfig: {
          id: 1,
          agentType: 'claude-code',
          name: 'Test Agent',
          // non-null modelId avoids Smart Router path
          modelId: 'claude-haiku-4-5-20251001',
          apiKeyEncrypted: null,
          endpoint: null,
        },
      }),
    ),
  },
  aIAgentConfig: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  developerModeConfig: {
    findUnique: mock(() =>
      Promise.resolve({
        id: 1,
        taskId: 1,
        isEnabled: true,
        enableDetailedLogging: false,
        enableIntermediateSaves: false,
        verbosityLevel: 'normal',
        maxRetries: 3,
        breakpointPhases: null,
      }),
    ),
    create: mock(() => Promise.resolve({ id: 1, taskId: 1, isEnabled: true })),
  },
};

mock.module('../../config', () => ({
  prisma: mockPrisma,
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => loggerMock,
  ensureDatabaseConnection: () => Promise.resolve(),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
}));

mock.module('./transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));

// workflow-mode-config: standard mode, research_done → planner transition.
mock.module('./workflow-mode-config', () => ({
  getModeSettings: mock(() =>
    Promise.resolve({
      hasPlanPhase: true,
      hasReviewPhase: false,
      hasAutoVerify: false,
    }),
  ),
  buildTransitions: mock(() => ({
    research_done: {
      role: 'planner',
      nextStatus: 'plan_created',
      outputFile: 'plan',
      requiresApproval: true,
    },
  })),
  selectProvisionalMode: mock(() => Promise.resolve('standard')),
}));

mock.module('./role-provider-resolver', () => ({
  inferProviderFromModelId: mock(() => 'claude'),
  resolveRoleProviderPreferences: mock(() => Promise.resolve({})),
}));

mock.module('../ai/agent-fallback', () => ({
  agentTypeToProvider: mock(() => 'claude'),
  findAgentConfigForProvider: mock(() => Promise.resolve(null)),
}));

// NOTE: Prevent tryProviderFallback from calling executeCLIAgent a second time.
// classifyAgentError returning null causes tryProviderFallback to bail immediately,
// so executeCLIAgent is called at most once regardless of whether the error path
// enters tryProviderFallback. This isolates the catch-block assertions from
// the fallback retry loop.
mock.module('../ai/agent-error-classifier', () => ({
  classifyAgentError: mock(() => null),
}));

// Import WorkflowOrchestrator AFTER all mock.module calls.
const { WorkflowOrchestrator } = await import('./workflow-orchestrator');

function resetMocks() {
  warnMock.mockClear();
  errorMock.mockClear();
  executeCLIAgentMock.mockClear();
  mockPrisma.task.findUnique.mockClear();
  executeCLIAgentImpl = () =>
    Promise.resolve({ success: true, role: 'planner', status: 'plan_created' });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkflowOrchestrator catch block — shutdown handling', () => {
  beforeEach(resetMocks);

  test('shutdown error → log.warn called, advanceWorkflow resolves with {success:false}', async () => {
    (WorkflowOrchestrator as unknown as { instance: unknown }).instance = undefined;
    const orchestrator = WorkflowOrchestrator.getInstance();

    executeCLIAgentImpl = () =>
      Promise.reject(new Error(buildShutdownErrorMessage('start new execution')));

    // NOTE: In 63d54cbc implementation, the catch block returns {success:false} instead of
    // re-throwing. advanceWorkflow RESOLVES (does not reject) for shutdown errors.
    const result = await orchestrator.advanceWorkflow(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Server is shutting down');

    // WARN must have been logged for the shutdown interruption.
    const warnMessages = warnMock.mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => m.includes('Shutdown interrupted'))).toBe(true);

    // ERROR for execution failure must NOT have been logged.
    const errorMessages = errorMock.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]),
    );
    expect(errorMessages.some((m) => m.includes('Error in planner'))).toBe(false);

    // executeCLIAgent was called once — no fallback attempt.
    expect(executeCLIAgentMock.mock.calls.length).toBe(1);
  });

  test('non-shutdown error → log.error called, advanceWorkflow resolves with {success:false}', async () => {
    (WorkflowOrchestrator as unknown as { instance: unknown }).instance = undefined;
    const orchestrator = WorkflowOrchestrator.getInstance();

    executeCLIAgentImpl = () => Promise.reject(new Error('Database connection refused'));

    const result = await orchestrator.advanceWorkflow(1);
    expect(result.success).toBe(false);

    // ERROR must have been logged.
    const errorMessages = errorMock.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]),
    );
    expect(errorMessages.some((m) => m.includes('Error in planner'))).toBe(true);

    // WARN for shutdown must NOT have been logged.
    const warnMessages = warnMock.mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => m.includes('Shutdown interrupted'))).toBe(false);
  });
});

/**
 * role-resolver テスト
 *
 * resolveAgentForTask's decision tree: no-workflow-context bail-out, terminal
 * statuses returning null, unmapped-status fallback, explicit
 * WorkflowRoleConfig assignment (incl. the shouldAutoSelectModel derivation
 * for null/'auto'/blank modelId), and the capability-based recommender
 * fallback when no role config exists or the role is disabled.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

let taskState: { workflowStatus: string; workflowMode: string } | null = null;
let roleConfigRow: {
  agentConfigId: number | null;
  isEnabled: boolean;
  modelId: string | null;
} | null = null;

const taskUpdateMock = mock(() => Promise.resolve({}));
mock.module('../../config/database', () => ({
  prisma: {
    workflowRoleConfig: { findUnique: () => Promise.resolve(roleConfigRow) },
    task: { update: taskUpdateMock },
  },
}));

// Bun's mock.module is process-global — when this file runs alongside
// workflow-orchestrator.transitions.test.ts (both mock '../task/task-resolver'
// for the same underlying module path), whichever mock registers must mirror
// every export the real module has, or the OTHER file's real (unmocked)
// import of a missing export throws "Export named '...' not found".
mock.module('../task/task-resolver', () => ({
  resolveTaskWithTheme: () => Promise.resolve(null),
  resolveTaskWithThemeAndCategory: () => Promise.resolve(null),
  resolveTaskForExecution: () => Promise.resolve(null),
  resolveTaskWorkingDirectory: () => Promise.resolve(null),
  resolveTaskWorkflowState: () => Promise.resolve(taskState),
  resolveTaskTitle: () => Promise.resolve(null),
  resolveTaskThemeId: () => Promise.resolve(null),
  resolveTaskForComplexityAnalysis: () => Promise.resolve(null),
  resolveTaskSubtaskInfo: () => Promise.resolve(null),
  resolveTaskForPlanApproval: () => Promise.resolve(null),
  resolveTaskForAutoMerge: () => Promise.resolve(null),
  resolveTaskForLearning: () => Promise.resolve(null),
  taskRowConfirmedAbsent: () => Promise.resolve(false),
}));

// reconcileStatusFromExistingArtifacts (called by resolveAgentForTask before
// picking a role) resolves the workflow dir and reads research.md/plan.md.
// Defaults to a no-op (no directory) for the existing tests below, which
// don't exercise artifact reuse; the dedicated describe block further down
// overrides these to verify the reconciliation actually engages.
let workflowDir: { dir: string } | null = null;
let artifactContent: Record<string, string | null> = {};
mock.module('./workflow-file-utils', () => ({
  resolveWorkflowDir: () => Promise.resolve(workflowDir),
  deleteWorkflowDir: () => Promise.resolve(true),
  readWorkflowFile: (_dir: string, fileType: string) =>
    Promise.resolve(artifactContent[fileType] ?? null),
  writeWorkflowFile: () => Promise.resolve(),
  archiveWorkflowFile: () => Promise.resolve(false),
  cleanupRootWorkflowFiles: () => Promise.resolve(),
  looksLikeAgentLog: () => false,
  sliceFromReportHeading: (text: string) => text,
  extractMarkdownFromOutput: () => null,
}));
mock.module('./phase-output-validator', () => ({
  looksLogPolluted: () => false,
  validateResearch: () => ({ ok: true }),
  validatePlan: () => ({ ok: true }),
  validateVerify: () => ({ ok: true }),
  isReusableArtifact: (_fileType: string, content: string) => !!content,
}));
mock.module('./transition-recorder', () => ({
  recordTransition: () => Promise.resolve(),
}));

// role → status map fixed to a small, deterministic table for this test.
mock.module('./workflow-mode-config', () => ({
  getModeSettings: () => Promise.resolve({}),
  buildRoleByStatus: () => ({
    draft: 'researcher',
    research_done: 'planner',
    plan_approved: 'implementer',
    // 'unmapped_status' intentionally absent to exercise the no-role branch.
  }),
}));

let recommended: {
  agentConfigId: number;
  agentType: string;
  agentName: string;
  score: number;
  reason: string;
} | null = null;
mock.module('./role-recommender', () => ({
  recommendAgentForRole: () => Promise.resolve(recommended),
}));

const { resolveAgentForTask } = await import('./role-resolver');

beforeEach(() => {
  taskState = null;
  roleConfigRow = null;
  recommended = null;
  workflowDir = null;
  artifactContent = {};
  taskUpdateMock.mockClear();
});

describe('resolveAgentForTask — bail-out paths', () => {
  test('no workflow context (task not found) → null', async () => {
    taskState = null;
    expect(await resolveAgentForTask(1)).toBeNull();
  });

  test('terminal status "completed" → null (nothing left to run)', async () => {
    taskState = { workflowStatus: 'completed', workflowMode: 'standard' };
    expect(await resolveAgentForTask(1)).toBeNull();
  });

  test('terminal status "verify_done" → null', async () => {
    taskState = { workflowStatus: 'verify_done', workflowMode: 'standard' };
    expect(await resolveAgentForTask(1)).toBeNull();
  });

  test("a valid but unmapped status (not in this mode's role table) → null", async () => {
    // 'in_progress' is a real WorkflowStatus (survives narrowing) but is
    // deliberately absent from the mocked buildRoleByStatus table below.
    taskState = { workflowStatus: 'in_progress', workflowMode: 'standard' };
    expect(await resolveAgentForTask(1)).toBeNull();
  });
});

describe('resolveAgentForTask — explicit WorkflowRoleConfig assignment', () => {
  test('enabled config with an agentConfigId is used directly', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = { agentConfigId: 7, isEnabled: true, modelId: 'claude-sonnet-4-5' };
    const r = await resolveAgentForTask(1);
    expect(r).toEqual({
      role: 'researcher',
      agentConfigId: 7,
      modelId: 'claude-sonnet-4-5',
      shouldAutoSelectModel: false,
    });
  });

  test('modelId of null → shouldAutoSelectModel true, modelId null', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = { agentConfigId: 7, isEnabled: true, modelId: null };
    const r = await resolveAgentForTask(1);
    expect(r?.shouldAutoSelectModel).toBe(true);
    expect(r?.modelId).toBeNull();
  });

  test('modelId === "auto" → shouldAutoSelectModel true', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = { agentConfigId: 7, isEnabled: true, modelId: 'auto' };
    const r = await resolveAgentForTask(1);
    expect(r?.shouldAutoSelectModel).toBe(true);
  });

  test('modelId of only whitespace → shouldAutoSelectModel true', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = { agentConfigId: 7, isEnabled: true, modelId: '   ' };
    const r = await resolveAgentForTask(1);
    expect(r?.shouldAutoSelectModel).toBe(true);
  });
});

describe('resolveAgentForTask — capability-recommender fallback', () => {
  test('a disabled role config falls through to the recommender for the agent, but the pinned modelId is still honored', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = { agentConfigId: 7, isEnabled: false, modelId: 'claude-sonnet-4-5' };
    recommended = {
      agentConfigId: 9,
      agentType: 'claude-code',
      agentName: 'Claude',
      score: 90,
      reason: 'Strong fit',
    };
    const r = await resolveAgentForTask(1);
    expect(r?.agentConfigId).toBe(9);
    // shouldAutoSelectModel is derived from the role's modelId regardless of
    // isEnabled — an explicit, non-'auto' modelId is still honored even when
    // the agentConfigId assignment itself was disabled.
    expect(r?.shouldAutoSelectModel).toBe(false);
    expect(r?.modelId).toBe('claude-sonnet-4-5');
  });

  test('no role config row at all falls through to the recommender', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = null;
    recommended = {
      agentConfigId: 11,
      agentType: 'gemini-cli',
      agentName: 'Gemini',
      score: 70,
      reason: 'Acceptable fit',
    };
    const r = await resolveAgentForTask(1);
    expect(r?.agentConfigId).toBe(11);
    expect(r?.role).toBe('researcher');
  });

  test('an enabled config with agentConfigId null falls through to the recommender', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = { agentConfigId: null, isEnabled: true, modelId: null };
    recommended = {
      agentConfigId: 5,
      agentType: 'codex',
      agentName: 'Codex',
      score: 60,
      reason: 'Acceptable',
    };
    const r = await resolveAgentForTask(1);
    expect(r?.agentConfigId).toBe(5);
  });

  test('recommender itself finds nothing → role with agentConfigId null, auto-select true', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    roleConfigRow = null;
    recommended = null;
    const r = await resolveAgentForTask(1);
    expect(r).toEqual({
      role: 'researcher',
      agentConfigId: null,
      modelId: null,
      shouldAutoSelectModel: true,
    });
  });
});

describe('resolveAgentForTask — artifact-reuse reconciliation (manual execute path)', () => {
  beforeEach(() => {
    workflowDir = { dir: '/fake/tasks/1' };
    artifactContent = {};
  });

  test('a reusable research.md already on disk fast-forwards draft -> research_done, so the planner (not researcher) is picked', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    artifactContent.research = 'a non-empty research report body';
    roleConfigRow = { agentConfigId: 7, isEnabled: true, modelId: 'claude-sonnet-4-5' };
    const r = await resolveAgentForTask(1);
    expect(r?.role).toBe('planner');
  });

  test('no workflow directory resolvable leaves the status (and role) unchanged', async () => {
    taskState = { workflowStatus: 'draft', workflowMode: 'standard' };
    workflowDir = null;
    artifactContent.research = 'a non-empty research report body';
    roleConfigRow = { agentConfigId: 7, isEnabled: true, modelId: 'claude-sonnet-4-5' };
    const r = await resolveAgentForTask(1);
    expect(r?.role).toBe('researcher');
  });
});

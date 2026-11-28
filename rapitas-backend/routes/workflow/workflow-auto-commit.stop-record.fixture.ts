/**
 * performAutoCommitAndPR stop-record fixture
 *
 * Module doubles and mutable state for workflow-auto-commit.stop-record.test.ts.
 * Not responsible for any assertion.
 */
import { mock } from 'bun:test';

const silent = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => silent, logger: silent }));

export interface Row {
  taskId: number;
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  cause: string;
  phase: string | null;
  metadata: string;
}

export interface PreSave {
  ok: boolean;
  summary: string;
  tamper: { name: string; ok: boolean; details: string } | null;
  secrets: string[];
  unattributed: string[];
}

export const cleanPreSave: PreSave = {
  ok: true,
  summary: 'ok',
  tamper: null,
  secrets: [],
  unattributed: [],
};

export const passedGuard = {
  ok: true,
  baseSync: { status: 'skipped', changedFiles: 0, conflicts: [], detail: '' },
  verifiedRevision: 'a'.repeat(40),
  headRevision: 'a'.repeat(40),
  verdict: 'pass',
};

/** Everything a case may change; reset it in beforeEach. */
export const state = {
  rows: [] as Row[],
  writeFails: false,
  holdRowExists: false,
  preSave: cleanPreSave,
  guard: {} as Record<string, unknown>,
  repair: { bounced: false } as { bounced: boolean; stale?: boolean },
};

const prismaDouble = {
  agentExecutionConfig: {
    findUnique: async () => ({ autoCommit: true, autoCreatePR: true, autoMergePR: false }),
  },
  task: {
    findUnique: async () => ({
      id: 1,
      title: 't',
      workflowStatus: 'verify_done',
      theme: { workingDirectory: 'C:\\work', defaultBranch: 'develop' },
      developerModeConfig: { agentSessions: [{ id: 1, branchName: 'b', worktreePath: null }] },
    }),
    updateMany: async () => ({ count: 0 }),
  },
  workflowTransition: {
    create: async ({ data }: { data: Row }) => {
      if (state.writeFails) throw new Error('db down');
      state.rows.push(data);
      return data;
    },
    // Answers both "was a hold recorded since" and the repeat-failure lookup.
    findFirst: async ({ where }: { where: { cause?: string } }) =>
      where.cause === 'verification_unverifiable_hold' && state.holdRowExists ? { id: 9 } : null,
  },
};
mock.module('../../config', () => ({ prisma: prismaDouble, getProjectRoot: () => 'C:\\other' }));

mock.module('../../services/workflow/publication-cancellation-guard', () => ({
  PUBLICATION_CANCELLED_ERROR: 'cancelled',
  publicationAborted: async () => false,
}));
mock.module('../../services/workflow/automation-policy', () => ({
  resolveAutomationPolicy: async () => ({
    autoCommit: true,
    autoCreatePR: true,
    autoMergePR: false,
  }),
  isStagedCompletionEnabled: () => true,
}));

type Gate = import('../../services/agents/verification/verification-gate').GateOutcome;
export const passingGate: Gate = { ok: true, result: null, verdict: 'pass' };
export const gateMock = mock(async (): Promise<Gate> => passingGate);
mock.module('../../services/agents/verification/verification-gate', () => ({
  runVerificationGate: gateMock,
}));
mock.module('../../services/agents/agent-orchestrator', () => ({
  AgentOrchestrator: { getInstance: () => ({ createPullRequest: async () => ({}) }) },
}));
mock.module('./workflow-activity-logger', () => ({
  logAutoCommit: async () => {},
  logAutoPR: async () => {},
}));
mock.module('./commit-cwd', () => ({ resolveCommitCwd: async () => 'C:\\work' }));
mock.module('../../services/workflow/harness-drift-sync', () => ({
  syncHarnessIfDrifted: async () => null,
}));
mock.module('./workflow-auto-commit-presave', () => ({
  readHeadRevision: async () => 'a'.repeat(40),
  listWorkingTreeChanges: async () => [],
  runPreSaveChecks: async () => ({ ...state.preSave, record: state.preSave }),
  saveTaskWorkLocally: async () => ({ success: true, hash: 'abc', branch: 'b' }),
}));
mock.module('./workflow-auto-commit-publish-guard', () => ({
  syncAndReverifyBeforePublish: async () => state.guard,
}));

// The HTTP caller's own dependencies, for the stale / exhausted repair cases.
mock.module('../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: async () => state.repair,
}));
mock.module('../../services/workflow/verify-self-repair-budget', () => ({
  resolveRepairWindowStart: async () => null,
}));
mock.module('../../services/workflow/transition-recorder', () => ({
  recordTransition: async (input: { cause: string }) => {
    state.rows.push(input as unknown as Row);
  },
}));
mock.module('./handlers/file-save/shared', () => ({ markLatestExecutionFailed: async () => {} }));

export const { performAutoCommitAndPR } = await import('./workflow-auto-commit');
export const { handleVerifyGateBlocked } =
  await import('./handlers/file-save/verify-commit-pr-gate-blocked');

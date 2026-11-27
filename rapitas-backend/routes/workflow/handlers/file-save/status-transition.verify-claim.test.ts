/**
 * status-transition.verify-claim.test
 *
 * The save path looks up the job a verify.md's claim cites (by task id and the
 * saved content) and hands it to validateVerify as the 3rd argument (F7). The
 * state write after that lookup goes through the REAL receipt-checked advance
 * on an isolated SQLite database, so a stop that lands while the lookup is in
 * flight is judged by the production guard, not by a test double (C3).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../../../generated/prisma-sqlite';
import { replanSnapshotDigest } from '../../../../services/workflow/requirement-replan-evidence';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let dir: string;
let db: PrismaClient;
// Every access resolves against the database of the running test.
const prisma = new Proxy({} as PrismaClient, { get: (_t, key) => Reflect.get(db, key) });
mock.module('../../../../config', () => ({ prisma }));
mock.module('../../../../services/workflow/completion-gate', () => ({
  researchConcludesNoChange: () => false,
}));
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));
mock.module('../../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: mock(() => Promise.resolve([])),
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(() => Promise.resolve()),
  wasNonConvergenceCutoffJustRecorded: mock(() => Promise.resolve(false)),
}));
mock.module('../../../../services/workflow/plan-for-verify', () => ({
  loadPlanContentForVerify: async () => 'PLAN',
}));

const MEASURED = { job: { status: 'completed', ok: true, revision: 'abc1234' } };
const loadMeasuredVerification = mock(async (_taskId: number, _content: string) => MEASURED);
mock.module('../../../../services/workflow/verify-claim-loader', () => ({
  loadMeasuredVerification,
}));

const mockValidateVerify = mock(() => ({
  ok: true,
  missingSections: [] as string[],
  severity: 0,
  summary: '',
}));
mock.module('../../../../services/workflow/phase-output-validator', () => ({
  validateVerify: mockValidateVerify,
}));

const TASK_ID = 715;
const evaluatedAt = new Date('2026-09-08T00:00:00Z');
// The snapshot the real guard re-reads; its digest must match the receipt's review.
const snapshot = {
  title: 'task',
  description: '',
  goals: [],
  constraints: [],
  acceptanceCriteria: ['実測と照合する'],
  planPolicy: { mode: 'standard' as const, includePlan: true },
  plan: 'PLAN',
  verify: 'verify body',
};
// The replan review itself is out of scope here; it hands back a passing receipt
// pinned to the task version read before the measured-job lookup.
mock.module('../../../../services/workflow/requirement-replan-service', () => ({
  attemptRequirementReplan: mock(async () => ({
    committed: false,
    reason: 'no_mismatch',
    completionReceipt: {
      taskId: TASK_ID,
      executionId: null,
      evaluatedUpdatedAt: evaluatedAt,
      review: {
        snapshotDigest: replanSnapshotDigest(snapshot),
        durationMs: 1,
        tokensUsed: 0,
        modelName: null,
        verdict: { kind: 'no_mismatch', reason: 'matching requirements' },
      },
    },
  })),
}));
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: mock(() => Promise.resolve({ bounced: false })),
}));

const { computeAndApplyStatusTransition } = await import('./status-transition');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rapitas-verify-claim-save-'));
  db = new PrismaClient({
    datasources: { db: { url: `file:${join(dir, 'test.db').replaceAll('\\', '/')}` } },
  });
  // Minimal isolated schema for the real receipt check; never touches the operational database.
  for (const sql of [
    'CREATE TABLE Task (workspaceId INTEGER, id INTEGER PRIMARY KEY, title TEXT, description TEXT, goals TEXT, constraints TEXT, acceptanceCriteria TEXT, status TEXT, workflowStatus TEXT, updatedAt DATETIME, themeId INTEGER, parentId INTEGER, completedAt DATETIME, githubPrId INTEGER, workflowMode TEXT)',
    'CREATE TABLE WorkflowFile (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER, fileType TEXT, content TEXT, UNIQUE(taskId,fileType))',
    'CREATE TABLE WorkflowModeConfig (workspaceId INTEGER, id INTEGER PRIMARY KEY, mode TEXT, stepDefinitions TEXT)',
    'CREATE TABLE DeveloperModeConfig (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER)',
    'CREATE TABLE AgentSession (workspaceId INTEGER, id INTEGER PRIMARY KEY, configId INTEGER)',
    "CREATE TABLE AgentExecution (workspaceId INTEGER, id INTEGER PRIMARY KEY, command TEXT NOT NULL DEFAULT 'execute', sessionId INTEGER, status TEXT, startedAt DATETIME)",
    'CREATE TABLE ThemeAutoRun (workspaceId INTEGER, id INTEGER PRIMARY KEY, themeId INTEGER UNIQUE, status TEXT)',
    'CREATE TABLE WorkflowTransition (workspaceId INTEGER, id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, fromStatus TEXT, toStatus TEXT, actor TEXT, cause TEXT, phase TEXT, executionId INTEGER, sessionId INTEGER, metadata TEXT DEFAULT "{}", invariantViolation BOOLEAN DEFAULT 0, invariantMessage TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE RequirementReviewClaim (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, snapshotDigest TEXT, requestKey TEXT, status TEXT, claimToken TEXT, ownerInstanceId TEXT, heartbeatAt DATETIME, resultJson TEXT, reason TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME, UNIQUE(taskId,snapshotDigest))',
  ])
    await db.$executeRawUnsafe(sql);
  await db.$executeRawUnsafe(
    "INSERT INTO Task (id, title, description, goals, constraints, acceptanceCriteria, status, workflowStatus, workflowMode, updatedAt) VALUES (?, ?, ?, '[]', '[]', ?, 'in-progress', 'in_progress', 'standard', ?)",
    TASK_ID,
    snapshot.title,
    snapshot.description,
    JSON.stringify(snapshot.acceptanceCriteria),
    evaluatedAt,
  );
  await db.$executeRawUnsafe(
    'INSERT INTO WorkflowFile (id, taskId, fileType, content) VALUES (1, ?, ?, ?), (2, ?, ?, ?)',
    TASK_ID,
    'plan',
    snapshot.plan,
    TASK_ID,
    'verify',
    snapshot.verify,
  );
  loadMeasuredVerification.mockClear();
  mockValidateVerify.mockClear();
});

afterEach(async () => {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

const save = () =>
  computeAndApplyStatusTransition({
    taskId: TASK_ID,
    fileType: 'verify',
    currentStatus: 'in_progress',
    savedContent: 'verify body',
  });

const admittedCount = () =>
  db.workflowTransition.count({ where: { taskId: TASK_ID, cause: 'verify_review_admitted' } });

describe('computeAndApplyStatusTransition — verify-claim hand-off', () => {
  test('passes the measured job of the saved verify.md to validateVerify, then advances', async () => {
    await save();
    expect(loadMeasuredVerification).toHaveBeenCalledWith(TASK_ID, 'verify body');
    expect(mockValidateVerify).toHaveBeenCalledWith('verify body', 'PLAN', MEASURED);
    // Control for the stop case below: without a stop the real guard admits the review.
    expect(await admittedCount()).toBe(1);
  });

  test('a stop recorded while the measured job is being fetched blocks the advance (C3)', async () => {
    loadMeasuredVerification.mockImplementationOnce(async () => {
      // The durable stop intent lands while the lookup is in flight.
      await db.$executeRawUnsafe(
        "INSERT INTO WorkflowTransition (taskId, actor, cause, createdAt) VALUES (?, 'system', 'theme_stop_execution_requested', ?)",
        TASK_ID,
        evaluatedAt,
      );
      return MEASURED;
    });
    await expect(save()).rejects.toThrow('stop_not_resumed');
    expect(await admittedCount()).toBe(0);
    expect(
      await db.task.findUnique({ where: { id: TASK_ID }, select: { workflowStatus: true } }),
    ).toEqual({ workflowStatus: 'in_progress' });
  });

  test('another verify.md saved while the lookup is in flight makes this admission stale', async () => {
    loadMeasuredVerification.mockImplementationOnce(async () => {
      // A newer report replaces the one this save validated (different snapshot).
      await db.$executeRawUnsafe(
        "UPDATE WorkflowFile SET content = 'newer verify body' WHERE taskId = ? AND fileType = 'verify'",
        TASK_ID,
      );
      return MEASURED;
    });
    await expect(save()).rejects.toThrow('stale_snapshot');
    expect(await admittedCount()).toBe(0);
  });

  test('a state change by another actor during the lookup makes this admission stale', async () => {
    loadMeasuredVerification.mockImplementationOnce(async () => {
      // e.g. a repair bounce or a reviewer moved the task on while this save waited.
      await db.$executeRawUnsafe(
        "UPDATE Task SET workflowStatus = 'plan_approved', updatedAt = ? WHERE id = ?",
        new Date(evaluatedAt.getTime() + 60_000),
        TASK_ID,
      );
      return MEASURED;
    });
    await expect(save()).rejects.toThrow(/held/);
    expect(await admittedCount()).toBe(0);
    expect(
      await db.task.findUnique({ where: { id: TASK_ID }, select: { workflowStatus: true } }),
    ).toEqual({ workflowStatus: 'plan_approved' });
  });
});

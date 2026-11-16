/**
 * verify-adversarial-review — 差し戻しの根拠の保存と要件不備の再計画（結合テスト）
 *
 * routing2a-fix1 項目1・4 の再現。HTTP 保存経路の陪審差し戻しを、本物の
 * attemptVerifyRepair → commitVerifyRepair → summarizeRepairCauses まで SQLite 上で通す。
 * - 項目1: attemptVerifyRepair が状態を plan_approved に変えた後は、後続の
 *   adversarial_review_failed 行（指摘）が書かれない。根拠は差し戻しの行そのものに
 *   保存されていなければならない。
 * - 項目4: 根拠つきの指摘がすべて要件不備なら、実装修復ではなく再計画（planner）へ戻す。
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaClient } from '../../../../generated/prisma-sqlite';

const holder: { db: PrismaClient | null } = { db: null };
const prismaProxy = new Proxy(
  {},
  { get: (_t, name) => (holder.db as unknown as Record<string | symbol, unknown>)[name] },
);
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));
mock.module('../../../../config/database', () => ({
  prisma: prismaProxy,
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../../../config', () => ({
  prisma: prismaProxy,
  ensureDatabaseConnection: async () => {},
  createLogger: () => noopLogger,
  logger: noopLogger,
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => undefined,
  getProjectRoot: () => process.cwd(),
}));

type Finding = Record<string, unknown>;
let reviewFindings: Finding[] = [];
mock.module('../../../../services/agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: async () => ({
    verdict: 'fail',
    severity: 'blocker',
    reasons: reviewFindings.map((f) => String(f.summary)),
    findings: reviewFindings,
    diffFingerprint: 'fp-1',
  }),
}));
mock.module('../../../../services/workflow/worktree-rebuild-recovery', () => ({
  tryRecoverFromHistoryContamination: async () => ({ recovered: false }),
  notifyRecoveryFallbackBlocked: async () => {},
}));
mock.module('../../../../services/workflow/verify-jury-completion', () => ({
  withTaskJuryGate: <T>(_taskId: number, fn: () => Promise<T>) => fn(),
  JuryGateBusyError: class JuryGateBusyError extends Error {},
  readVerifySha256: async () => null,
  recordJuryGateCompletion: async () => {},
}));
// The runner is not under test; the committed receipt is.
mock.module('../../../../services/workflow/verify-self-repair-resume', () => ({
  ensureRunnerResumes: async () => {},
  resolveRepairCaller: () => 'adversarial_review',
}));

// The DB jury lock (design 4.5.1) is covered on real SQLite in
// services/workflow/jury-review-run.test.ts; here it is granted and nothing drifts.
const { fakeJuryRunModule, fakeJuryRunState } =
  await import('../../../../services/workflow/jury-review-run.test-helpers');
const juryRun = fakeJuryRunState(() => null);
mock.module('../../../../services/workflow/jury-review-run', () => fakeJuryRunModule(juryRun));
const { runAdversarialDiffReview } = await import('./verify-adversarial-review');
const { summarizeRepairCauses } = await import('../../../../services/workflow/repair-escalation');
const { buildReviewReplanContext } =
  await import('../../../../services/workflow/workflow-review-replan-context');

const SAVED_VERIFY = '## 全体判定\n✅ 検証成功\n';
const now = new Date('2026-11-10T00:00:00Z');
let dir = '';

const grounded = (summary: string): Finding => ({
  severity: 'blocker',
  summary,
  evidence: 'services/foo.ts:42',
  gating: true,
  verification: 'holds',
});

async function seed(db: PrismaClient, withPlan: boolean): Promise<void> {
  for (const sql of [
    'CREATE TABLE Task (workspaceId INTEGER, id INTEGER PRIMARY KEY, title TEXT, status TEXT, workflowStatus TEXT, updatedAt DATETIME, themeId INTEGER, parentId INTEGER)',
    'CREATE TABLE WorkflowFile (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER, fileType TEXT, content TEXT, sha256 TEXT, sizeBytes INTEGER, absolutePath TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME, UNIQUE(taskId,fileType))',
    'CREATE TABLE DeveloperModeConfig (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER)',
    'CREATE TABLE AgentSession (workspaceId INTEGER, id INTEGER PRIMARY KEY, configId INTEGER, worktreePath TEXT, status TEXT, createdAt DATETIME)',
    "CREATE TABLE AgentExecution (workspaceId INTEGER, id INTEGER PRIMARY KEY, command TEXT NOT NULL DEFAULT 'execute', sessionId INTEGER, status TEXT, startedAt DATETIME, createdAt DATETIME, errorMessage TEXT, completedAt DATETIME)",
    'CREATE TABLE ThemeAutoRun (workspaceId INTEGER, id INTEGER PRIMARY KEY, themeId INTEGER UNIQUE, status TEXT)',
    'CREATE TABLE WorkflowFileVersion (workspaceId INTEGER, id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, fileType TEXT, content TEXT, sha256 TEXT, sizeBytes INTEGER, archivedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE ActivityLog (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER, action TEXT, createdAt DATETIME)',
    'CREATE TABLE WorkflowTransition (workspaceId INTEGER, id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, fromStatus TEXT, toStatus TEXT, actor TEXT, cause TEXT, phase TEXT, executionId INTEGER, sessionId INTEGER, metadata TEXT DEFAULT "{}", invariantViolation BOOLEAN DEFAULT 0, invariantMessage TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
    'INSERT INTO DeveloperModeConfig (id, taskId) VALUES (1,1)',
    "INSERT INTO AgentSession (id, configId, worktreePath, status) VALUES (1,1,'/wt/1','completed')",
  ])
    await db.$executeRawUnsafe(sql);
  if (withPlan) {
    await db.$executeRawUnsafe(
      "INSERT INTO WorkflowFile (id,taskId,fileType,content,updatedAt) VALUES (1,1,'plan','# plan',?)",
      new Date(now.getTime() - 60_000),
    );
  }
  await db.$executeRawUnsafe(
    "INSERT INTO WorkflowFile (id,taskId,fileType,content,sha256,sizeBytes,updatedAt) VALUES (2,1,'verify',?,'x',1,?)",
    SAVED_VERIFY,
    now,
  );
  await db.$executeRawUnsafe(
    "INSERT INTO Task (id,title,status,workflowStatus,updatedAt,themeId) VALUES (1,'t','in-progress','verify_done',?,NULL)",
    now,
  );
  await db.$executeRawUnsafe(
    "INSERT INTO AgentExecution (id, sessionId, status, startedAt, createdAt) VALUES (1,1,'completed',?,?)",
    now,
    now,
  );
}

async function openDb(withPlan = true): Promise<PrismaClient> {
  dir = await mkdtemp(join(tmpdir(), 'rapitas-repair-evidence-'));
  const db = new PrismaClient({
    datasources: { db: { url: `file:${join(dir, 'test.db').replaceAll('\\', '/')}` } },
  });
  holder.db = db;
  await seed(db, withPlan);
  return db;
}

const review = () =>
  runAdversarialDiffReview({
    taskId: 1,
    fileType: 'verify',
    newStatus: 'verify_done',
    verifyGateBlocked: false,
    isConflictResolutionTask: false,
    savedContent: SAVED_VERIFY,
    preferredBaseBranchForVerify: null,
  });

async function repairRow(db: PrismaClient): Promise<Record<string, unknown>> {
  const row = await db.workflowTransition.findFirst({ where: { cause: 'verify_repair' } });
  expect(row).not.toBeNull();
  return JSON.parse(row!.metadata) as Record<string, unknown>;
}

const status = async (db: PrismaClient) =>
  (await db.task.findUnique({ where: { id: 1 }, select: { workflowStatus: true } }))
    ?.workflowStatus;

beforeEach(() => {
  reviewFindings = [];
});
afterEach(async () => {
  await holder.db?.$disconnect();
  holder.db = null;
  if (dir) {
    const target = resolve(dir);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('rapitas-repair-evidence-')
    )
      throw new Error('Unsafe test cleanup path');
    await rm(target, { recursive: true, force: true });
    dir = '';
  }
});

describe('HTTP 保存経路の陪審差し戻し', () => {
  test('項目1: 根拠つきの指摘が差し戻しと同じ行に残り、能力不足として数えられる', async () => {
    const db = await openDb();
    reviewFindings = [grounded('null を返す経路で例外になる')];
    await review();

    expect(await status(db)).toBe('plan_approved');
    const meta = await repairRow(db);
    expect(Array.isArray(meta.findings)).toBe(true);
    expect((meta.findings as Finding[])[0].summary).toBe('null を返す経路で例外になる');
    const summary = await summarizeRepairCauses(1);
    expect(summary.capability).toBe(1);
    expect(summary.unfounded).toBe(0);
  });

  test('項目1: 根拠の無い指摘だけなら、保存しても根拠不明のまま（格上げしない）', async () => {
    await openDb();
    reviewFindings = [
      { severity: 'major', summary: '品質が低い', gating: false, needsCheck: true },
    ];
    await review();
    const summary = await summarizeRepairCauses(1);
    expect(summary.capability).toBe(0);
    expect(summary.unfounded).toBe(1);
  });

  test('項目4: 根拠つきの指摘がすべて要件不備なら、planner（research_done）へ戻して再計画させる', async () => {
    const db = await openDb();
    reviewFindings = [grounded('受入基準3が計画と矛盾しており実装では満たせない')];
    await review();

    expect(await status(db)).toBe('research_done');
    const meta = await repairRow(db);
    expect(meta.route).toBe('replan');
    expect((meta.resumeReceipt as { workflowStatus: string }).workflowStatus).toBe('research_done');
    const summary = await summarizeRepairCauses(1);
    expect(summary.requirements).toBe(1);
    expect(summary.capability).toBe(0);
    const ctx = await buildReviewReplanContext(1, 'ja');
    expect(ctx).toContain('受入基準3が計画と矛盾しており実装では満たせない');
    // Once the planner saves a newer plan.md, the findings are not injected again.
    await db.$executeRawUnsafe(
      "UPDATE WorkflowFile SET updatedAt = ? WHERE taskId = 1 AND fileType = 'plan'",
      new Date(Date.now() + 60_000),
    );
    expect(await buildReviewReplanContext(1, 'ja')).toBe('');
  });

  test('項目4: 実装不具合が混じる差し戻しは、従来どおり implementer へ戻す', async () => {
    const db = await openDb();
    reviewFindings = [
      grounded('受入基準3が計画と矛盾しており実装では満たせない'),
      grounded('null を返す経路で例外になる'),
    ];
    await review();
    expect(await status(db)).toBe('plan_approved');
    expect((await repairRow(db)).route).toBe('implement');
    expect(await buildReviewReplanContext(1, 'ja')).toBe('');
  });

  test('項目4: plan の無い軽量タスクは planner が無いので implementer へ戻す（要件不備として記録）', async () => {
    const db = await openDb(false);
    reviewFindings = [grounded('受入基準3が計画と矛盾しており実装では満たせない')];
    await review();
    expect(await status(db)).toBe('research_done');
    const meta = await repairRow(db);
    expect(meta.route).toBe('implement');
    expect(meta.requestedRoute).toBe('replan');
    expect(await buildReviewReplanContext(1, 'ja')).toBe('');
  });
});

/**
 * Requirement replan hold condition
 *
 * A mismatch verdict holds the task only when it carries a concrete unmet
 * requirement (failed measurement, expected and observed values). A verdict
 * whose own fields contradict the hold is recorded and the task moves on.
 * Runs the real parser, service and commit against an isolated SQLite file.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import type { PrismaClient as PostgresClient } from '../../generated/prisma-postgres';
import { advanceReviewedVerify } from './requirement-replan-commit';
import { reviewRequirementReplan } from './requirement-replan-review';
import { attemptRequirementReplan } from './requirement-replan-service';

const PREFIX = 'rapitas-replan-conflict-';
const criterion = '完了状態を維持';
const plan = '状態処理は非対象';
const verify = '完了状態を上書きした';
let dir: string;
let db: PrismaClient;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), PREFIX));
  db = new PrismaClient({
    datasources: { db: { url: `file:${join(dir, 'test.db').replaceAll('\\', '/')}` } },
  });
  // Minimal isolated schema for the real Prisma queries; never reads the operational database.
  for (const sql of [
    'CREATE TABLE Task (workspaceId INTEGER, id INTEGER PRIMARY KEY, title TEXT, description TEXT, goals TEXT, constraints TEXT, acceptanceCriteria TEXT, status TEXT, workflowStatus TEXT, workflowMode TEXT, updatedAt DATETIME, themeId INTEGER, parentId INTEGER, completedAt DATETIME)',
    'CREATE TABLE WorkflowFile (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER, fileType TEXT, content TEXT, UNIQUE(taskId,fileType))',
    'CREATE TABLE WorkflowModeConfig (workspaceId INTEGER, id INTEGER PRIMARY KEY, mode TEXT UNIQUE, stepDefinitions TEXT)',
    'CREATE TABLE DeveloperModeConfig (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER)',
    'CREATE TABLE AgentSession (workspaceId INTEGER, id INTEGER PRIMARY KEY, configId INTEGER)',
    "CREATE TABLE AgentExecution (workspaceId INTEGER, id INTEGER PRIMARY KEY, command TEXT NOT NULL DEFAULT 'execute', sessionId INTEGER, status TEXT, startedAt DATETIME)",
    'CREATE TABLE ThemeAutoRun (workspaceId INTEGER, id INTEGER PRIMARY KEY, themeId INTEGER UNIQUE, status TEXT)',
    'CREATE TABLE RequirementReviewClaim (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, snapshotDigest TEXT, requestKey TEXT, status TEXT, claimToken TEXT, ownerInstanceId TEXT, heartbeatAt DATETIME, resultJson TEXT, reason TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME, UNIQUE(taskId,snapshotDigest))',
    'CREATE TABLE RequirementReviewRetryRequest (workspaceId INTEGER, id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT UNIQUE, taskId INTEGER, consumedAt DATETIME, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE WorkflowTransition (workspaceId INTEGER, id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, fromStatus TEXT, toStatus TEXT, actor TEXT, cause TEXT, phase TEXT, executionId INTEGER, sessionId INTEGER, metadata TEXT DEFAULT "{}", invariantViolation BOOLEAN DEFAULT 0, invariantMessage TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
  ]) {
    await db.$executeRawUnsafe(sql);
  }
  await db.$executeRawUnsafe(
    "INSERT INTO Task (id, title, description, goals, constraints, acceptanceCriteria, status, workflowStatus, updatedAt) VALUES (1, 'test', '', '[]', '[]', ?, 'in-progress', 'plan_approved', ?)",
    JSON.stringify([criterion]),
    new Date('2026-09-08T00:00:00Z'),
  );
  await db.$executeRawUnsafe(
    'INSERT INTO WorkflowFile (id, taskId, fileType, content) VALUES (1,1,?,?), (2,1,?,?)',
    'plan',
    plan,
    'verify',
    verify,
  );
});

afterEach(async () => {
  await db?.$disconnect();
  if (!dir) return;
  const target = resolve(dir);
  // Only the unique directory returned by mkdtemp is removed.
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(PREFIX)) {
    throw new Error('Refusing cleanup outside the isolated test directory');
  }
  await rm(target, { recursive: true, force: true });
});

const base = {
  kind: 'mismatch',
  reason: '条件と非対象指定の矛盾',
  requirementUnmet: true,
  planPreventsRequirement: true,
  preservesRequirements: true,
  requiresOverridingUserConstraint: false,
  criterionIndex: 0,
  planLines: [0, 0],
  failureLines: [0, 0],
  measuredResult: 'failed',
  expected: 'status は done のまま',
  observed: 'status が awaiting_question になった',
};

const client = () => db as unknown as PostgresClient;

/** Run the real review parser on a fixed judge response. */
const judge = (response: Record<string, unknown>) =>
  attemptRequirementReplan(client(), 1, (source) =>
    reviewRequirementReplan(source, async () => ({
      content: JSON.stringify(response),
      tokensUsed: 1,
    })),
  );

const replanRows = () =>
  db.workflowTransition.findMany({ where: { cause: 'requirement_evidence_replan' } });

describe('a concrete unmet requirement holds the task', () => {
  test('records the reason, criterion, expected and observed values', async () => {
    const result = await judge(base);

    expect(result.committed).toBe(true);
    const rows = await replanRows();
    expect(rows).toHaveLength(1);
    const metadata = JSON.parse(rows[0].metadata as string);
    expect(metadata.reason).toBe(base.reason);
    expect(metadata.evidence).toMatchObject({
      criterion,
      expected: base.expected,
      observed: base.observed,
    });
  });
});

describe('a verdict that contradicts its own hold moves on', () => {
  const passingReason = '受入条件1〜6はいずれも実測テストで通過';
  const cases: Array<[string, Record<string, unknown>, string]> = [
    [
      'the measurement passed',
      { reason: passingReason, measuredResult: 'passed' },
      'measured_result_not_failed',
    ],
    ['the measurement is unstated', { measuredResult: undefined }, 'measured_result_not_failed'],
    ['expected is missing', { expected: undefined }, 'missing_expected'],
    ['expected is blank', { expected: '   ' }, 'missing_expected'],
    ['observed is missing', { observed: undefined }, 'missing_observed'],
    ['observed is not a string', { observed: 3 }, 'missing_observed'],
    ['observed equals expected', { observed: ` ${base.expected} ` }, 'observed_equals_expected'],
  ];

  for (const [name, override, code] of cases) {
    test(`does not hold when ${name}`, async () => {
      const result = await judge({ ...base, ...override });

      expect(result.committed).toBe(false);
      expect(result.reason).toBe('no_mismatch');
      expect(await replanRows()).toHaveLength(0);

      await advanceReviewedVerify(client(), result.completionReceipt!);
      const admitted = await db.workflowTransition.findFirst({
        where: { cause: 'verify_review_admitted' },
      });
      expect(JSON.parse(admitted!.metadata as string).reason).toContain(
        `review_inconclusive: verdict_reason_conflict:${code}: ${override.reason ?? base.reason}`,
      );
      expect(
        await db.task.findUnique({ where: { id: 1 }, select: { workflowStatus: true } }),
      ).toEqual({ workflowStatus: 'verify_done' });
    });
  }
});

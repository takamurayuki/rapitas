/**
 * criteria-jury-lock.acceptance.test
 *
 * Stage-2 acceptance (companion design §7 stage 2, 4.5 / 4.5.1 「検証」) through
 * the REAL CLI epilogue jury gate, completion records, JuryReviewRun lock,
 * writeTaskCriteria and halt release, on a real SQLite database. Only the
 * jury's verdict, the diff fingerprint and the repair loop are stand-ins.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { installSqliteJuryHarness, seedJudgeableTask } from './jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();

mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => 'fp-same',
  fingerprintDiff: () => 'fp-same',
}));
/** What the jury does when called; may act on the DB mid-review. */
let duringReview: (taskId: number) => Promise<void> = async () => {};
let verdict: 'pass' | 'fail' = 'pass';
const review = mock(async (p: { taskId: number }) => {
  await duringReview(p.taskId);
  return {
    verdict,
    severity: verdict === 'pass' ? 0 : 90,
    reasons: ['基準'],
    diffFingerprint: 'fp-same',
  };
});
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: review,
}));
const repair = mock(async (..._a: unknown[]) => ({ bounced: true, newStatus: 'plan_approved' }));
mock.module('./verify-self-repair', () => ({ attemptVerifyRepair: repair }));
mock.module('./publish/mark-latest-execution-failed', () => ({
  markLatestExecutionFailed: async () => {},
}));
const enqueue = mock(async (_o: unknown) => ({}));
mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue }) },
}));
const startProcessing = mock(() => {});
mock.module('./workflow-runner', () => ({
  WorkflowRunner: { getInstance: () => ({ startProcessing }) },
}));

const { runFallbackJuryGate } = await import('./verify-fallback-jury-gate');
const { writeTaskCriteria } = await import('../task/task-criteria-write');
const { computeCriteriaRevision } = await import('../task/task-criteria-revision');
const { releaseTaskHalt } = await import('./halt-release');

afterAll(dispose);

type WriteDb = Parameters<typeof writeTaskCriteria>[0];
const writeDb = db as unknown as WriteDb;

const gate = (taskId: number, currentWfStatus = 'in_progress') =>
  runFallbackJuryGate({
    taskId,
    currentWfStatus,
    verifyContent: '# verify',
    worktreePath: '/wt',
    actor: 'verifier',
    sessionId: 1,
  });

const completions = (taskId: number) =>
  db.timelineEvent.count({
    where: { eventType: 'adversarial_review_gate_completed', correlationId: `task-${taskId}` },
  });

beforeEach(() => {
  review.mockClear();
  repair.mockClear();
  enqueue.mockClear();
  startProcessing.mockClear();
  duringReview = async () => {};
  verdict = 'pass';
});

describe('criteria are part of what a verdict is bound to', () => {
  test('same verify.md and diff, only the criteria changed → the jury is called again', async () => {
    const taskId = await seedJudgeableTask(db);
    expect(await gate(taskId)).toEqual({ stop: false });
    expect(review).toHaveBeenCalledTimes(1);
    // Unchanged → reused, no second jury.
    expect(await gate(taskId)).toEqual({ stop: false, skipped: 'already_reviewed' });
    expect(review).toHaveBeenCalledTimes(1);

    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const w = await writeTaskCriteria(writeDb, {
      taskId,
      next: { acceptanceCriteria: ['キーワードで絞り込める', '検索語が URL に残る'] },
      expectedCriteriaRevision: computeCriteriaRevision(row),
      actor: 'test',
    });
    expect(w.ok).toBe(true);
    expect(await gate(taskId)).toEqual({ stop: false });
    expect(review).toHaveBeenCalledTimes(2);
    // Every run is kept, each with the revision it judged under.
    const runs = await db.juryReviewRun.findMany({ where: { taskId }, orderBy: { id: 'asc' } });
    expect(runs.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(runs[0].criteriaRevision).not.toBe(runs[1].criteriaRevision);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).juryRunId).toBeNull();
  });

  test('during the review the criteria cannot be changed (409 review_in_progress)', async () => {
    const taskId = await seedJudgeableTask(db);
    let refused: unknown = null;
    duringReview = async (id) => {
      const row = await db.task.findUniqueOrThrow({ where: { id } });
      refused = await writeTaskCriteria(writeDb, {
        taskId: id,
        next: { acceptanceCriteria: ['変えたい'] },
        expectedCriteriaRevision: computeCriteriaRevision(row),
        actor: 'test',
      });
    };
    await gate(taskId);
    expect(refused).toMatchObject({ ok: false, reason: 'review_in_progress' });
  });
});

describe('a verdict whose criteria drifted is discarded and the task halted', () => {
  test('a write past writeTaskCriteria mid-review → discarded_stale, jury_result_discarded, no completion, no bounce', async () => {
    const taskId = await seedJudgeableTask(db);
    verdict = 'fail';
    duringReview = async (id) => {
      await db.task.update({
        where: { id },
        data: { acceptanceCriteria: JSON.stringify(['直接書き換えた']) },
      });
    };
    const out = await gate(taskId);
    expect(out.stop).toBe(true);
    expect(repair).not.toHaveBeenCalled();
    expect(await completions(taskId)).toBe(0);
    const run = await db.juryReviewRun.findFirstOrThrow({ where: { taskId } });
    expect(run.status).toBe('discarded_stale');
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.haltReason).toBe('jury_result_discarded');
    expect(task.juryRunId).toBeNull();
    expect(
      await db.workflowTransition.count({ where: { taskId, cause: 'jury_result_discarded' } }),
    ).toBe(1);

    // While halted this way the person may fix the criteria...
    const fixed = await writeTaskCriteria(writeDb, {
      taskId,
      next: { acceptanceCriteria: ['キーワードで絞り込める'] },
      expectedCriteriaRevision: computeCriteriaRevision(task),
      actor: 'test',
    });
    expect(fixed.ok).toBe(true);

    // ...and releasing the halt sends it back to the verifier (verify is redone).
    const released = await releaseTaskHalt(taskId, '条件を直したので検証し直す', 'ユーザー操作');
    expect(released).toMatchObject({ ok: true, toStatus: 'in_progress' });
    const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after).toMatchObject({
      haltReason: null,
      workflowStatus: 'in_progress',
      status: 'in-progress',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(startProcessing).toHaveBeenCalledTimes(1);
    expect(
      await db.workflowTransition.findFirst({
        where: { taskId, cause: 'halt_released', toStatus: 'in_progress' },
      }),
    ).not.toBeNull();
  });

  test('releasing another halt reason keeps the workflow status (no re-verify)', async () => {
    const taskId = await seedJudgeableTask(db, {
      workflowStatus: 'verify_done',
      haltReason: 'cost_budget_exceeded',
    });
    const released = await releaseTaskHalt(taskId, '予算を見直したので再開する', 'ユーザー操作');
    expect(released).toMatchObject({ ok: true, toStatus: 'verify_done' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

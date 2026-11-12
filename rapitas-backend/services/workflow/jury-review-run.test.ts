/**
 * jury-review-run.test
 *
 * The DB jury lock against a real SQLite database (companion design 4.5.1,
 * 「検証」): lock-then-read ordering, the race with a criteria write, the
 * pre-apply re-check and discard, and the reclaim of dead runs.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { installSqliteJuryHarness, seedJudgeableTask } from './jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();

const {
  beginJuryRun,
  confirmJuryRunStillBound,
  finishJuryRun,
  JURY_RESULT_DISCARDED_RESUME,
  JURY_RUN_STALE_MS,
} = await import('./jury-review-run');
const { recoverJuryRunsAtStartup, sweepStaleJuryRuns } = await import('./jury-review-run-recovery');
const { writeTaskCriteria } = await import('../task/task-criteria-write');
const { computeCriteriaRevision, revisionOfLists } = await import('../task/task-criteria-revision');
const { recordJuryGateCompletion } = await import('./verify-jury-completion');

type WriteDb = Parameters<typeof writeTaskCriteria>[0];
const writeDb = db as unknown as WriteDb;

const NEW_CRITERIA = ['キーワードで絞り込める', '0件のとき案内が出る', '検索語が URL に残る'];

const taskRow = (id: number) =>
  db.task.findUniqueOrThrow({
    where: { id },
    select: {
      juryRunId: true,
      updatedAt: true,
      acceptanceCriteria: true,
      goals: true,
      constraints: true,
      haltReason: true,
      resumeCondition: true,
      workflowStatus: true,
    },
  });
const runRow = (id: number) => db.juryReviewRun.findUniqueOrThrow({ where: { id } });

let finishOpen: Array<{ id: number; taskId: number }> = [];

beforeEach(async () => {
  // Close any run a test left open so its heartbeat timer stops.
  for (const r of finishOpen) await finishJuryRun(r, { status: 'abandoned' });
  finishOpen = [];
});

afterAll(async () => {
  for (const r of finishOpen) await finishJuryRun(r, { status: 'abandoned' });
  await dispose();
});

async function begin(taskId: number, source: 'http_save' | 'cli_epilogue' = 'http_save') {
  const r = await beginJuryRun({ taskId, source });
  if (r.acquired) finishOpen.push(r.run);
  return r;
}

describe('taking the lock', () => {
  test('lock first, then read: the run records the criteria and verify.md it will be judged on', async () => {
    const taskId = await seedJudgeableTask(db);
    const before = await taskRow(taskId);
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    const after = await taskRow(taskId);
    expect(after.juryRunId).toBe(r.run.id);
    expect(r.run.verifySha256).toBe('verify-sha-1');
    expect(r.run.criteriaRevision).toBe(computeCriteriaRevision(before));
    const row = await runRow(r.run.id);
    expect(row).toMatchObject({
      status: 'running',
      source: 'http_save',
      criteriaRevision: r.run.criteriaRevision,
      verifySha256: 'verify-sha-1',
    });
    // The lock is not a content change: updatedAt (the replan receipt's version) is kept.
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    await finishJuryRun(r.run, { status: 'applied', verdict: 'pass', outcome: 'passed' });
    const released = await taskRow(taskId);
    expect(released.juryRunId).toBeNull();
    expect(released.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await runRow(r.run.id)).toMatchObject({ status: 'applied', outcome: 'passed' });
  });

  test('a second review while one holds the lock is closed as busy_skipped and does not start', async () => {
    const taskId = await seedJudgeableTask(db);
    const first = await begin(taskId);
    if (!first.acquired) throw new Error('expected the lock');
    const second = await beginJuryRun({ taskId, source: 'cli_epilogue' });
    expect(second.acquired).toBe(false);
    if (second.acquired) return;
    expect(await runRow(second.runId)).toMatchObject({ status: 'busy_skipped' });
    expect((await taskRow(taskId)).juryRunId).toBe(first.run.id);
  });
});

describe('criteria writes against the lock', () => {
  test('a write while a jury holds the lock → review_in_progress, criteria unchanged', async () => {
    const taskId = await seedJudgeableTask(db);
    const before = await taskRow(taskId);
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    const written = await writeTaskCriteria(writeDb, {
      taskId,
      next: { acceptanceCriteria: NEW_CRITERIA },
      expectedCriteriaRevision: computeCriteriaRevision(before),
      actor: 'test',
    });
    expect(written).toMatchObject({ ok: false, reason: 'review_in_progress' });
    expect((await taskRow(taskId)).acceptanceCriteria).toBe(before.acceptanceCriteria);
  });

  test('re-judging the SAME verify.md after a criteria change: a write mid-review is still refused', async () => {
    // The old criteria's completion record already exists for this verify.md —
    // the case "is there a completion record yet?" could not tell apart (v2).
    const taskId = await seedJudgeableTask(db);
    const old = await taskRow(taskId);
    await recordJuryGateCompletion({
      taskId,
      verifySha256: 'verify-sha-1',
      diffFingerprint: 'fp-1',
      criteriaRevision: computeCriteriaRevision(old),
      verdict: 'pass',
      outcome: 'passed',
      source: 'http_save',
    });
    const changed = await writeTaskCriteria(writeDb, {
      taskId,
      next: { acceptanceCriteria: NEW_CRITERIA },
      expectedCriteriaRevision: computeCriteriaRevision(old),
      actor: 'test',
    });
    expect(changed.ok).toBe(true);
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    const again = await writeTaskCriteria(writeDb, {
      taskId,
      next: { acceptanceCriteria: ['別の条件'] },
      expectedCriteriaRevision: changed.ok ? changed.revision : '',
      actor: 'test',
    });
    expect(again).toMatchObject({ ok: false, reason: 'review_in_progress' });
  });

  test('race A — the writer read before the lock, the lock lands first: the write loses', async () => {
    const taskId = await seedJudgeableTask(db);
    const before = await taskRow(taskId);
    let lockedRun: number | null = null;
    // Intercept only the writer's conditional update: take the lock in between.
    const racing = new Proxy(writeDb, {
      get(target, prop) {
        if (prop !== 'task') return Reflect.get(target, prop);
        return {
          findUnique: (a: never) => target.task.findUnique(a),
          updateMany: async (a: Parameters<WriteDb['task']['updateMany']>[0]) => {
            const r = await begin(taskId);
            if (r.acquired) lockedRun = r.run.id;
            return target.task.updateMany(a);
          },
        };
      },
    });
    const written = await writeTaskCriteria(racing, {
      taskId,
      next: { acceptanceCriteria: NEW_CRITERIA },
      actor: 'test',
    });
    expect(lockedRun).not.toBeNull();
    expect(written).toMatchObject({ ok: false, reason: 'review_in_progress' });
    const now = await taskRow(taskId);
    // "lock held, criteria old"
    expect(now.juryRunId).toBe(lockedRun);
    expect(now.acceptanceCriteria).toBe(before.acceptanceCriteria);
  });

  test('race B — the write lands between run creation and the lock: the run records the NEW criteria', async () => {
    const taskId = await seedJudgeableTask(db);
    const before = await taskRow(taskId);
    // The write runs while the run row exists but the lock is not yet taken.
    const orig = db.task.updateMany.bind(db.task);
    let wrote = false;
    (db.task as unknown as { updateMany: unknown }).updateMany = async (
      a: Parameters<typeof orig>[0],
    ) => {
      const data = a.data as Record<string, unknown>;
      if (!wrote && 'juryRunId' in data && data.juryRunId !== null) {
        wrote = true;
        const w = await writeTaskCriteria(writeDb, {
          taskId,
          next: { acceptanceCriteria: NEW_CRITERIA },
          expectedCriteriaRevision: computeCriteriaRevision(before),
          actor: 'test',
        });
        expect(w.ok).toBe(true);
      }
      return orig(a);
    };
    try {
      const r = await begin(taskId);
      if (!r.acquired) throw new Error('expected the lock');
      expect(wrote).toBe(true);
      expect(r.run.criteriaRevision).toBe(
        revisionOfLists({
          goals: ['検索できる'],
          constraints: [],
          acceptanceCriteria: NEW_CRITERIA,
        }),
      );
    } finally {
      (db.task as unknown as { updateMany: unknown }).updateMany = orig;
    }
  });

  test('race C — run concurrently many times: exactly one side wins each time', async () => {
    for (let i = 0; i < 15; i++) {
      const taskId = await seedJudgeableTask(db);
      const before = await taskRow(taskId);
      const [lock, write] = await Promise.all([
        begin(taskId),
        writeTaskCriteria(writeDb, {
          taskId,
          next: { acceptanceCriteria: NEW_CRITERIA },
          expectedCriteriaRevision: computeCriteriaRevision(before),
          actor: 'test',
        }),
      ]);
      const now = await taskRow(taskId);
      expect(lock.acquired).toBe(true);
      if (!lock.acquired) continue;
      if (write.ok) {
        // The write landed first; the review read AFTER its lock, so it judges the new criteria.
        expect(lock.run.criteriaRevision).toBe(computeCriteriaRevision(now));
        expect(now.acceptanceCriteria).toBe(JSON.stringify(NEW_CRITERIA));
      } else {
        expect(write.reason).toBe('review_in_progress');
        expect(now.acceptanceCriteria).toBe(before.acceptanceCriteria);
        expect(lock.run.criteriaRevision).toBe(computeCriteriaRevision(before));
      }
      await finishJuryRun(lock.run, { status: 'applied' });
    }
  });
});

describe('re-check before applying a verdict', () => {
  test('criteria rewritten past writeTaskCriteria → discarded_stale, halted, no lock left', async () => {
    const taskId = await seedJudgeableTask(db, { workflowStatus: 'verify_done' });
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    // A write that bypassed the helper (the case the re-check exists for).
    await db.task.update({
      where: { id: taskId },
      data: { acceptanceCriteria: JSON.stringify(NEW_CRITERIA) },
    });
    const ok = await confirmJuryRunStillBound(r.run, { verdict: 'pass', diffFingerprint: 'fp-1' });
    expect(ok).toBe(false);
    const run = await runRow(r.run.id);
    expect(run.status).toBe('discarded_stale');
    const reason = JSON.parse(run.discardReason ?? '{}') as {
      drift: Array<{ field: string; before: unknown; after: unknown }>;
    };
    expect(reason.drift).toEqual([
      {
        field: 'criteriaRevision',
        before: r.run.criteriaRevision,
        after: computeCriteriaRevision(await taskRow(taskId)),
      },
    ]);
    const task = await taskRow(taskId);
    expect(task.haltReason).toBe('jury_result_discarded');
    expect(task.resumeCondition).toBe(JURY_RESULT_DISCARDED_RESUME);
    expect(task.juryRunId).toBeNull();
    const t = await db.workflowTransition.findFirst({
      where: { taskId, cause: 'jury_result_discarded' },
    });
    expect(t).not.toBeNull();
    const completions = await db.timelineEvent.count({
      where: { eventType: 'adversarial_review_gate_completed', correlationId: `task-${taskId}` },
    });
    expect(completions).toBe(0);
  });

  test('verify.md re-saved during the review → discarded (verifySha256 drift)', async () => {
    const taskId = await seedJudgeableTask(db);
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    await db.workflowFile.updateMany({ where: { taskId }, data: { sha256: 'verify-sha-2' } });
    expect(await confirmJuryRunStillBound(r.run, null)).toBe(false);
    const run = await runRow(r.run.id);
    expect(JSON.parse(run.discardReason ?? '{}')).toEqual({
      drift: [{ field: 'verifySha256', before: 'verify-sha-1', after: 'verify-sha-2' }],
    });
  });

  test('nothing changed → apply', async () => {
    const taskId = await seedJudgeableTask(db);
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    expect(await confirmJuryRunStillBound(r.run, null)).toBe(true);
    expect((await runRow(r.run.id)).status).toBe('running');
  });
});

describe('reclaiming dead runs', () => {
  /** A run another process started and then died with (not in this process's live set). */
  async function orphanRun(taskId: number, heartbeatAgoMs: number) {
    const run = await db.juryReviewRun.create({
      data: {
        taskId,
        source: 'cli_epilogue',
        status: 'running',
        ownerId: 'main-999-dead',
        heartbeatAt: new Date(Date.now() - heartbeatAgoMs),
      },
    });
    await db.task.update({ where: { id: taskId }, data: { juryRunId: run.id } });
    return run;
  }

  test('heartbeat stopped > 90 s → the periodic sweep abandons it and releases the lock', async () => {
    const taskId = await seedJudgeableTask(db);
    const run = await orphanRun(taskId, JURY_RUN_STALE_MS + 5_000);
    expect(await sweepStaleJuryRuns()).toBeGreaterThanOrEqual(1);
    expect((await runRow(run.id)).status).toBe('abandoned');
    expect((await taskRow(taskId)).juryRunId).toBeNull();
    // ...and the criteria can be changed again.
    const w = await writeTaskCriteria(writeDb, {
      taskId,
      next: { acceptanceCriteria: NEW_CRITERIA },
      actor: 'test',
    });
    expect(w.ok).toBe(true);
  });

  test('a heartbeat 60 s old is left alone', async () => {
    const taskId = await seedJudgeableTask(db);
    const run = await orphanRun(taskId, 60_000);
    await sweepStaleJuryRuns();
    expect((await runRow(run.id)).status).toBe('running');
    expect((await taskRow(taskId)).juryRunId).toBe(run.id);
    await finishJuryRun(run, { status: 'abandoned' });
  });

  test('a run alive in THIS process is never swept, even with an old heartbeat', async () => {
    const taskId = await seedJudgeableTask(db);
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    await db.juryReviewRun.update({
      where: { id: r.run.id },
      data: { heartbeatAt: new Date(Date.now() - 10 * JURY_RUN_STALE_MS) },
    });
    await sweepStaleJuryRuns();
    expect((await runRow(r.run.id)).status).toBe('running');
  });

  test('startup: a run whose heartbeat predates this boot is reclaimed even if only seconds old', async () => {
    const taskId = await seedJudgeableTask(db);
    const run = await orphanRun(taskId, 5_000);
    await recoverJuryRunsAtStartup(new Date());
    expect((await runRow(run.id)).status).toBe('abandoned');
    expect((await taskRow(taskId)).juryRunId).toBeNull();
  });

  test('a reclaimed run that comes back with a verdict is not applied', async () => {
    const taskId = await seedJudgeableTask(db);
    const r = await begin(taskId);
    if (!r.acquired) throw new Error('expected the lock');
    // What another process's sweep would do to it.
    await db.juryReviewRun.update({ where: { id: r.run.id }, data: { status: 'abandoned' } });
    await db.task.update({ where: { id: taskId }, data: { juryRunId: null } });
    expect(await confirmJuryRunStillBound(r.run, { verdict: 'pass' })).toBe(false);
    // It stays abandoned (the discard does not rewrite a reclaimed run).
    expect((await runRow(r.run.id)).status).toBe('abandoned');
  });
});

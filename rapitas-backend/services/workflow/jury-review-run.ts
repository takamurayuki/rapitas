/**
 * jury-review-run
 *
 * The persisted state of one adversarial-jury review and the DB lock it holds
 * (companion design 4.5.1): JuryReviewRun rows plus Task.juryRunId. Owns the
 * start (create the run → take the lock → only THEN read verify.md's sha256
 * and the criteria revision), the heartbeat, the pre-apply re-check of those
 * three identifiers, the close (applied / discarded_stale / busy_skipped /
 * abandoned) and the discard halt. Not responsible for running the jury or
 * applying its verdict (verify-adversarial-review.ts, verify-fallback-jury-gate.ts)
 * nor for reclaiming dead runs (jury-review-run-recovery.ts).
 *
 * The in-process queue (withTaskJuryGate) still orders the two gates of THIS
 * process; this lock is what other writers — a criteria change, a run left
 * over from before a restart — see.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { EXECUTION_OWNER_ID } from '../agents/execution-owner';
import { readCriteriaRevision } from '../task/task-criteria-revision';
import { JURY_RESULT_DISCARDED_HALT_REASON } from '../task/task-criteria-write';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow:jury-review-run');

/** Heartbeat cadence — the same as the execution lease (execution-heartbeat.ts). */
export const JURY_RUN_HEARTBEAT_MS = 15_000;

/** A running run whose heartbeat is older than this is dead (six missed beats). */
export const JURY_RUN_STALE_MS = 90_000;

/** Transition cause recorded when a verdict is discarded as stale. */
export const JURY_RESULT_DISCARDED_CAUSE = 'jury_result_discarded';

/** resumeCondition written with the discard halt (design 4.5.1). */
export const JURY_RESULT_DISCARDED_RESUME =
  '完了条件がレビュー中に変わったため、判定を捨てた。verify をやり直す';

export { JURY_RESULT_DISCARDED_HALT_REASON };

/** Which gate runs the review (JuryGateSource without human_override). */
export type JuryRunSource = 'http_save' | 'cli_epilogue';

/** A run that holds the task's jury lock. */
export interface JuryRunHandle {
  id: number;
  taskId: number;
  source: JuryRunSource;
  /** verify.md sha256 read after the lock was taken (null when unreadable). */
  verifySha256: string | null;
  /** Criteria revision read after the lock was taken (null when unreadable). */
  criteriaRevision: string | null;
}

/** One identifier that no longer matches what the run recorded. */
export interface JuryRunDrift {
  field: 'juryRunId' | 'criteriaRevision' | 'verifySha256';
  before: string | number | null;
  after: string | number | null;
}

const heartbeats = new Map<number, ReturnType<typeof setInterval>>();

/**
 * Ids of runs alive in THIS process. The periodic sweep never reclaims these,
 * even if a heartbeat write is momentarily failing.
 *
 * @returns Live run ids / このプロセスで生きている run の id
 */
export function liveJuryRunIds(): number[] {
  return [...heartbeats.keys()];
}

function startHeartbeat(runId: number): void {
  if (heartbeats.has(runId)) return;
  const beat = () =>
    prisma.juryReviewRun
      .updateMany({ where: { id: runId, status: 'running' }, data: { heartbeatAt: new Date() } })
      .catch((err: unknown) => log.warn({ err, runId }, '[jury-run] Heartbeat write failed'));
  heartbeats.set(
    runId,
    setInterval(() => void beat(), JURY_RUN_HEARTBEAT_MS),
  );
}

function stopHeartbeat(runId: number): void {
  const timer = heartbeats.get(runId);
  if (timer) clearInterval(timer);
  heartbeats.delete(runId);
}

/**
 * Set or clear Task.juryRunId without moving Task.updatedAt. The lock is not
 * a content change, and updatedAt is the version other compare-and-swaps hold
 * on to — the requirement-replan receipt (requirement-replan-commit.ts) is
 * read before the jury and checked after merge; a bump here would hold every
 * reviewed completion.
 *
 * @returns 'ok', or 'not_held' when the expected lock value is not there
 */
async function swapTaskLock(
  taskId: number,
  expected: number | null,
  next: number | null,
): Promise<'ok' | 'not_held'> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await prisma.task.findUnique({
      where: { id: taskId },
      select: { juryRunId: true, updatedAt: true },
    });
    if (!row || row.juryRunId !== expected) return 'not_held';
    const res = await prisma.task.updateMany({
      where: { id: taskId, juryRunId: expected, updatedAt: row.updatedAt },
      data: { juryRunId: next, updatedAt: row.updatedAt },
    });
    if (res.count === 1) return 'ok';
    // updatedAt moved between the read and the write (an unrelated update);
    // re-read and try again — the lock condition itself is re-checked.
  }
  log.warn({ taskId, expected, next }, '[jury-run] Lock swap kept racing other updates');
  return 'not_held';
}

/**
 * Start a review: create the run, take the task's jury lock, and only then
 * read the identifiers the jury will judge against. When another run holds
 * the lock, this run is closed as busy_skipped and the review must NOT start.
 *
 * @param p.taskId - Task to review / 対象タスク
 * @param p.source - Which gate / どのゲートか
 * @returns The locked run, or { acquired:false } / ロックを取れた run、または取れなかったこと
 */
export async function beginJuryRun(p: {
  taskId: number;
  source: JuryRunSource;
}): Promise<{ acquired: true; run: JuryRunHandle } | { acquired: false; runId: number }> {
  const created = await prisma.juryReviewRun.create({
    data: { taskId: p.taskId, source: p.source, status: 'running', ownerId: EXECUTION_OWNER_ID },
    select: { id: true },
  });
  const locked = await swapTaskLock(p.taskId, null, created.id);
  if (locked !== 'ok') {
    await prisma.juryReviewRun
      .update({
        where: { id: created.id },
        data: { status: 'busy_skipped', finishedAt: new Date() },
      })
      .catch((err: unknown) => log.warn({ err, runId: created.id }, '[jury-run] Close failed'));
    log.warn({ taskId: p.taskId, runId: created.id }, '[jury-run] Lock held elsewhere — skipped');
    return { acquired: false, runId: created.id };
  }
  startHeartbeat(created.id);
  // Read AFTER the lock: the jury reads the criteria from the task row
  // (adversarial-diff-review.ts), and from here no criteria write can land.
  const { readVerifySha256 } = await import('./verify-jury-completion');
  const [verifySha256, criteriaRevision] = await Promise.all([
    readVerifySha256(p.taskId),
    readCriteriaRevision(prisma, p.taskId),
  ]);
  await prisma.juryReviewRun
    .update({ where: { id: created.id }, data: { verifySha256, criteriaRevision } })
    .catch((err: unknown) => log.warn({ err, runId: created.id }, '[jury-run] Start write failed'));
  return {
    acquired: true,
    run: { id: created.id, taskId: p.taskId, source: p.source, verifySha256, criteriaRevision },
  };
}

/**
 * Re-check, right before a verdict is acted on, that the run still owns the
 * lock and that the criteria revision and verify.md are what it started on.
 * An unreadable identifier counts as drift. Never throws.
 *
 * @param run - The running run / 実行中の run
 * @returns The drifted identifiers (empty = safe to apply) / ずれた項目（空なら適用してよい）
 */
export async function juryRunDrift(run: JuryRunHandle): Promise<JuryRunDrift[]> {
  try {
    const { readVerifySha256 } = await import('./verify-jury-completion');
    const [task, criteriaRevision, verifySha256] = await Promise.all([
      prisma.task.findUnique({ where: { id: run.taskId }, select: { juryRunId: true } }),
      readCriteriaRevision(prisma, run.taskId),
      readVerifySha256(run.taskId),
    ]);
    const drift: JuryRunDrift[] = [];
    if (task?.juryRunId !== run.id) {
      drift.push({ field: 'juryRunId', before: run.id, after: task?.juryRunId ?? null });
    }
    if (!criteriaRevision || criteriaRevision !== run.criteriaRevision) {
      drift.push({
        field: 'criteriaRevision',
        before: run.criteriaRevision,
        after: criteriaRevision,
      });
    }
    if (!verifySha256 || verifySha256 !== run.verifySha256) {
      drift.push({ field: 'verifySha256', before: run.verifySha256, after: verifySha256 });
    }
    return drift;
  } catch (err) {
    log.warn({ err, runId: run.id }, '[jury-run] Drift check failed — treating as drift');
    return [{ field: 'juryRunId', before: run.id, after: null }];
  }
}

/** What the jury saw, recorded on the run when it closes as applied. */
export interface JuryRunSeen {
  diffFingerprint?: string | null;
  verdict?: string | null;
  outcome?: 'passed' | 'stopped' | null;
}

/**
 * Run a gate body under a JuryReviewRun: take the lock first, hand the run to
 * the body, and close it afterwards — applied on return, abandoned on a throw
 * (the lock is released either way). When the lock is held elsewhere the body
 * is not run at all and `onBusy` decides the result, exactly like the
 * in-process JuryGateBusyError.
 *
 * @param p.taskId - Task / タスク
 * @param p.source - Gate / ゲート
 * @param body - The review + apply, returning its result and what the jury saw / 本体
 * @param onBusy - Result when another run holds the lock / ロックが取れなかったときの結果
 * @returns The body's (or onBusy's) result / 結果
 */
export async function withJuryRun<T>(
  p: { taskId: number; source: JuryRunSource },
  body: (run: JuryRunHandle) => Promise<{ result: T; seen: JuryRunSeen }>,
  onBusy: () => T | Promise<T>,
): Promise<T> {
  const begun = await beginJuryRun(p);
  if (!begun.acquired) return onBusy();
  const { run } = begun;
  try {
    const { result, seen } = await body(run);
    // A discarded run is already closed; finishJuryRun leaves its status alone.
    await finishJuryRun(run, { status: 'applied', ...seen });
    return result;
  } catch (err) {
    await finishJuryRun(run, {
      status: 'abandoned',
      discardReason: {
        reason: 'gate_error',
        message: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

/**
 * The pre-apply gate both jury gates call right after a verdict comes back:
 * true = still bound to what the run started on, go ahead; false = drifted,
 * and the verdict has been discarded (run closed, task halted) — the caller
 * must act on NOTHING, like a stale verify request. Never throws.
 *
 * @param run - The running run / 実行中の run
 * @param review - The verdict about to be applied (null = review errored) / 適用しようとしている判定
 * @returns Whether the verdict may be applied / 適用してよいか
 */
export async function confirmJuryRunStillBound(
  run: JuryRunHandle,
  review: { verdict: string; diffFingerprint?: string | null } | null,
): Promise<boolean> {
  const drift = await juryRunDrift(run);
  if (drift.length === 0) return true;
  await discardStaleJuryResult(run, drift, {
    diffFingerprint: review?.diffFingerprint ?? null,
    verdict: review?.verdict ?? null,
  }).catch((err: unknown) => log.error({ err, runId: run.id }, '[jury-run] Discard failed'));
  return false;
}

/**
 * Close a run and release its lock (only its own — a conditional clear).
 * A run already reclaimed (abandoned) keeps that status. Never throws.
 *
 * @param run - The run / 対象 run
 * @param end - Final status and what the jury saw / 終了状態と陪審が見たもの
 */
export async function finishJuryRun(
  run: Pick<JuryRunHandle, 'id' | 'taskId'>,
  end: {
    status: 'applied' | 'discarded_stale' | 'abandoned';
    diffFingerprint?: string | null;
    verdict?: string | null;
    outcome?: 'passed' | 'stopped' | null;
    discardReason?: unknown;
  },
): Promise<void> {
  stopHeartbeat(run.id);
  await prisma.juryReviewRun
    .updateMany({
      where: { id: run.id, status: 'running' },
      data: {
        status: end.status,
        finishedAt: new Date(),
        diffFingerprint: end.diffFingerprint ?? null,
        verdict: end.verdict ?? null,
        outcome: end.outcome ?? null,
        ...(end.discardReason !== undefined
          ? { discardReason: JSON.stringify(end.discardReason) }
          : {}),
      },
    })
    .catch((err: unknown) => log.warn({ err, runId: run.id }, '[jury-run] Close write failed'));
  await swapTaskLock(run.taskId, run.id, null).catch((err: unknown) =>
    log.warn({ err, runId: run.id }, '[jury-run] Lock release failed'),
  );
}

/**
 * Discard a verdict whose identifiers drifted: close the run as
 * discarded_stale (with what drifted, before/after), release its lock, and
 * halt the task for a person (haltReason='jury_result_discarded'). Writes no
 * completion record and applies nothing. Never throws.
 *
 * @param run - The run / 対象 run
 * @param drift - What no longer matched / ずれた項目
 * @param seen - What the jury saw (kept on the run for the trail) / 陪審が見たもの
 */
export async function discardStaleJuryResult(
  run: JuryRunHandle,
  drift: JuryRunDrift[],
  seen: { diffFingerprint?: string | null; verdict?: string | null },
): Promise<void> {
  await finishJuryRun(run, {
    status: 'discarded_stale',
    diffFingerprint: seen.diffFingerprint,
    verdict: seen.verdict,
    outcome: null,
    discardReason: { drift },
  });
  // NOTE: Halt only when no other halt is set — a budget halt or a review
  // hold keeps its own reason and resume path.
  const live = await prisma.task
    .findUnique({ where: { id: run.taskId }, select: { workflowStatus: true } })
    .catch(() => null);
  const halted = await prisma.task
    .updateMany({
      where: { id: run.taskId, OR: [{ haltReason: null }, { haltReason: '' }] },
      data: {
        haltReason: JURY_RESULT_DISCARDED_HALT_REASON,
        haltedAt: new Date(),
        resumeCondition: JURY_RESULT_DISCARDED_RESUME,
      },
    })
    .catch((err: unknown) => {
      log.warn({ err, runId: run.id }, '[jury-run] Discard halt write failed');
      return { count: 0 };
    });
  await recordTransition({
    taskId: run.taskId,
    fromStatus: live?.workflowStatus ?? null,
    toStatus: live?.workflowStatus ?? 'verify_done',
    actor: 'system',
    cause: JURY_RESULT_DISCARDED_CAUSE,
    phase: 'verify',
    metadata: {
      juryRunId: run.id,
      source: run.source,
      drift,
      verdict: seen.verdict ?? null,
      halted: halted.count === 1,
    },
  }).catch(() => {});
  log.warn(
    { taskId: run.taskId, runId: run.id, drift },
    '[jury-run] Verdict discarded — identifiers drifted during the review; task halted',
  );
}

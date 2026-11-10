/**
 * verify-jury-completion
 *
 * The "this exact verify.md + this exact diff was judged, and the gate acted
 * on it" record shared by the two places that run the adversarial jury before
 * commit/PR (the HTTP verify.md save pipeline and the CLI epilogue's fallback
 * gate), plus the per-task serialisation that makes the two take turns.
 * Not responsible for running the jury or for any status transition.
 *
 * Why not "an adversarial_review event newer than verify.md": that event is
 * appended by the jury itself, before the HTTP path has acted on the verdict,
 * and it names neither the artifact nor the diff. A slow review of an OLD diff
 * finishing after a new verify.md was saved looked exactly like a review of
 * the new one (G2 review item 1). The completion record is written only after
 * the gate finished acting, and carries verify.md's sha256 and the reviewed
 * diff's fingerprint; reuse requires both to match.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:verify-jury-completion');

/** Timeline event type of a completion record. */
export const JURY_GATE_COMPLETED_EVENT = 'adversarial_review_gate_completed' as const;

/** How many recent completion records to scan for a match. */
const COMPLETION_SCAN_LIMIT = 20;

/**
 * Longest a gate waits for the other path's gate on the same task. A jury
 * review is bounded by its juror timeouts; past this the waiter runs its own
 * review (a duplicate review is safe, a deadlocked pipeline is not).
 */
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000;

/** Which pipeline ran the gate. */
export type JuryGateSource = 'http_save' | 'cli_epilogue';

/** What the gate did with the verdict: let commit/PR proceed, or stop it. */
export type JuryGateOutcome = 'passed' | 'stopped';

/** One completed gate run, bound to the artifact and diff it judged. */
export interface JuryGateCompletion {
  taskId: number;
  /** WorkflowFile.sha256 of verify.md read when the gate started. */
  verifySha256: string;
  /** Fingerprint of the diff the jury actually reviewed. */
  diffFingerprint: string;
  verdict: string;
  outcome: JuryGateOutcome;
  source: JuryGateSource;
  completedAt: string;
}

const tails = new Map<number, Promise<void>>();

/**
 * Run `fn` after any other gate on the same task has finished (in-process,
 * FIFO). Both jury gates live in the backend process, so this is what makes
 * the epilogue wait for an HTTP review that is still deciding.
 *
 * @param taskId - Task id / タスクID
 * @param fn - The gate body / ゲート本体
 * @param maxWaitMs - Give up waiting after this long and run anyway / 待機上限
 * @returns Whatever `fn` returns / fn の戻り値
 */
export async function withTaskJuryGate<T>(
  taskId: number,
  fn: () => Promise<T>,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
): Promise<T> {
  const previous = tails.get(taskId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => mine);
  tails.set(taskId, tail);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    previous.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), maxWaitMs);
    }),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    log.warn(
      { taskId, maxWaitMs },
      '[jury-gate] Waited too long for the other gate — running anyway',
    );
  }
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(taskId) === tail) tails.delete(taskId);
  }
}

/**
 * verify.md's stored sha256 (the artifact version a gate is judging).
 *
 * @param taskId - Task id / タスクID
 * @returns The sha256, or null when there is no readable verify.md / sha256（無ければ null）
 */
export async function readVerifySha256(taskId: number): Promise<string | null> {
  try {
    const row = await prisma.workflowFile.findFirst({
      where: { taskId, fileType: 'verify' },
      select: { sha256: true },
    });
    return row?.sha256 || null;
  } catch {
    return null;
  }
}

/**
 * Persist a completion record. Call only AFTER the gate acted on the verdict
 * (bounce/block written, or commit allowed), and never for a stale verdict.
 * Never throws.
 *
 * @param c - Completion to record (completedAt is filled in) / 記録する完了
 */
export async function recordJuryGateCompletion(
  c: Omit<JuryGateCompletion, 'completedAt'>,
): Promise<void> {
  try {
    const { appendEvent } = await import('../memory/timeline');
    await appendEvent({
      eventType: JURY_GATE_COMPLETED_EVENT,
      actorType: 'system',
      payload: { ...c, completedAt: new Date().toISOString() },
      correlationId: `task-${c.taskId}`,
    });
  } catch (err) {
    log.warn({ err, taskId: c.taskId }, '[jury-gate] Failed to record gate completion');
  }
}

/**
 * The newest completion record for exactly this verify.md version and diff.
 * Never throws; an unreadable history is "not judged".
 *
 * @param taskId - Task id / タスクID
 * @param key - verify.md sha256 and current diff fingerprint / 成果物と差分の識別子
 * @returns Matching completion, or null / 一致する完了記録（無ければ null）
 */
export async function findJuryGateCompletion(
  taskId: number,
  key: { verifySha256: string; diffFingerprint: string },
): Promise<JuryGateCompletion | null> {
  try {
    const { queryEvents } = await import('../memory/timeline');
    const { events } = await queryEvents({
      eventType: JURY_GATE_COMPLETED_EVENT,
      correlationId: `task-${taskId}`,
      limit: COMPLETION_SCAN_LIMIT,
    });
    for (const e of events) {
      const p = e.payload as Partial<JuryGateCompletion> | undefined;
      if (
        p?.verifySha256 === key.verifySha256 &&
        p.diffFingerprint === key.diffFingerprint &&
        (p.outcome === 'passed' || p.outcome === 'stopped')
      ) {
        return p as JuryGateCompletion;
      }
    }
    return null;
  } catch {
    return null;
  }
}

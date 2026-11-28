/**
 * Critic In-Flight Registry
 *
 * Tracks the phase critique currently running for each task so the workflow
 * ADVANCE path can wait for the verdict before reading workflowStatus. The
 * save handler races the gate against a 90s timeout and fails open, but the
 * underlying critique keeps running — without this registry its late verdict
 * rolled the workflow back AFTER the next phase was already dispatched
 * (task 536: planner launched at ~0s, verdict at +96s), letting a rejected
 * artifact drive the next phase and breaking the regenerate-with-feedback
 * loop entirely. Not responsible for judging (phase-critic.ts) or bouncing
 * (phase-critic-gate.ts).
 */

const inFlight = new Map<number, Promise<unknown>>();
/** Saves that will start a critique but have not yet; each entry settles on release. */
const reservations = new Map<number, Set<Promise<void>>>();

/** Cap on how long an advance will wait for a verdict — comfortably above the
 * gate's own timeout so the wait ends via settlement, not this cap. */
const DEFAULT_SETTLE_CAP_MS = 150_000;

/**
 * Register a task's running critique. The registry entry removes itself on
 * settlement (only if it is still the current entry — a newer critique for
 * the same task must not be deleted by an older one settling late).
 *
 * @param taskId - Task being critiqued. / 批評中のタスク
 * @param critique - The critique promise. / 批評のPromise
 */
export function registerCritique(taskId: number, critique: Promise<unknown>): void {
  inFlight.set(taskId, critique);
  void critique
    .catch(() => {})
    .finally(() => {
      if (inFlight.get(taskId) === critique) inFlight.delete(taskId);
    });
}

/**
 * Mark a task as about to be critiqued, so a reader of the new workflowStatus
 * cannot slip in before the critique registers (task 1593).
 *
 * @param taskId - Task being saved. / 保存中のタスク
 * @returns Synchronous, idempotent release. / 同期で何度呼んでもよい解除関数
 */
export function reserveCritique(taskId: number): () => void {
  let settle!: () => void;
  const reservation = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const held = reservations.get(taskId) ?? new Set<Promise<void>>();
  reservations.set(taskId, held.add(reservation));
  return () => {
    held.delete(reservation);
    if (held.size === 0 && reservations.get(taskId) === held) reservations.delete(taskId);
    settle();
  };
}

/**
 * Whether a critique is currently in flight for the task (exported for tests).
 *
 * @param taskId - Task to check. / 対象タスク
 * @returns True when a critique is registered or reserved. / 実行中か予約中ならtrue
 */
export function hasCritiqueInFlight(taskId: number): boolean {
  return inFlight.has(taskId) || reservations.has(taskId);
}

/**
 * Wait until the task's reservations and in-flight critique (if any) settle, so the caller
 * observes the POST-verdict workflowStatus. Never throws; bounded by capMs.
 *
 * @param taskId - Task about to advance. / 前進しようとしているタスク
 * @param capMs - Upper bound on the wait. / 待機上限
 */
export async function awaitCriticSettled(
  taskId: number,
  capMs: number = DEFAULT_SETTLE_CAP_MS,
): Promise<void> {
  if (!hasCritiqueInFlight(taskId)) return;
  let capped = false;
  let capTimer: NodeJS.Timeout | undefined;
  const cap = new Promise<void>((resolve) => {
    capTimer = setTimeout(() => {
      capped = true;
      resolve();
    }, capMs);
  });
  // NOTE: Loops because a critique registers while its save still holds a
  // reservation, and may outlive it when the save stops waiting.
  while (!capped && hasCritiqueInFlight(taskId)) {
    const pending = [inFlight.get(taskId)?.catch(() => {}), ...(reservations.get(taskId) ?? [])];
    await Promise.race([Promise.all(pending), cap]);
  }
  clearTimeout(capTimer);
}

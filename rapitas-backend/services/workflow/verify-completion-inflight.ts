/**
 * Verify Completion In-Flight Registry
 *
 * Tracks the post-verify automation running for a task after its verify.md
 * was saved — the empty-diff completion gate, the adversarial jury review and
 * the commit / PR / merge pipeline — so the WorkflowRunner can wait for the
 * real outcome instead of guessing with a fixed grace window.
 *
 * The runner polls a `verify_done` task and, once its window expires, declares
 * the completion gate failed. That window was a blind 60s guess while the
 * automation itself is unbounded work (LLM jurors with a 120s timeout each,
 * scoped tests, git push, `gh pr create` over the network). Task 580 finished
 * in 127s: the runner marked it failed at ~70s and auto-run SKIPPED it, then
 * the pipeline created PR #7 57s later — a successful task left parked as
 * blocked with an unlinked PR. Task 658 (task 660) repeated it from the other
 * side: only the commit/PR stage was registered, so the gate + jury stages
 * that precede it ran unregistered and the 60s window expired at 63s while
 * the jury was still deliberating; PR #458 landed 3.5 minutes later.
 *
 * Same process as the save handler (the runner calls the HTTP pipeline
 * in-process), so a module-level registry is enough for the LIVE decision.
 * Every registration additionally writes `verify_pipeline_started` /
 * `verify_pipeline_settled` timeline events so the start and end of the
 * automation are observable AFTER the fact, independent of this process's
 * memory — the next "success parked as blocked" can be diagnosed from the DB
 * rather than reconstructed from a missing log file. Mirrors
 * phase-critic/critic-inflight.ts. Not responsible for running or judging the
 * automation — only for reporting that it is still working.
 */

/** Tasks whose post-verify automation is currently running. */
const inFlight = new Map<number, Promise<unknown>>();

/**
 * Durable, fire-and-forget trace of the automation lifecycle. Never awaited
 * by the registry and never allowed to throw: a failed audit write must not
 * alter the in-flight decision or the pipeline it observes.
 *
 * @param eventType - Lifecycle marker to persist. / 記録するイベント種別
 * @param payload - Task id plus outcome details. / タスクIDと結果
 */
function traceLifecycle(
  eventType: 'verify_pipeline_started' | 'verify_pipeline_settled',
  payload: Record<string, unknown>,
): void {
  import('../memory/timeline')
    .then(({ appendEvent }) => appendEvent({ eventType, actorType: 'system', payload }))
    .catch(() => {});
}

/**
 * Register a task's running post-verify automation. The entry removes itself
 * on settlement, and only when it is still the current entry — a newer run for
 * the same task must not be deleted by an older one settling late.
 *
 * @param taskId - Task whose automation started. / 対象タスクID
 * @param work - Promise that settles when the automation finishes. / 完了時に解決するPromise
 */
export function registerVerifyCompletion(taskId: number, work: Promise<unknown>): void {
  inFlight.set(taskId, work);
  const startedAt = Date.now();
  traceLifecycle('verify_pipeline_started', { taskId });
  void work
    .then(
      () => ({ outcome: 'resolved' as const }),
      (err: unknown) => ({
        outcome: 'rejected' as const,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    .then((settled) => {
      // Delete BEFORE tracing so the live decision is never delayed by the
      // audit import; the trace only describes what already happened.
      if (inFlight.get(taskId) === work) inFlight.delete(taskId);
      traceLifecycle('verify_pipeline_settled', {
        taskId,
        durationMs: Date.now() - startedAt,
        ...settled,
      });
    });
}

/**
 * Whether post-verify automation is still running for the task.
 *
 * @param taskId - Task to check. / 対象タスク
 * @returns True while the automation is registered. / 実行中なら true
 */
export function hasVerifyCompletionInFlight(taskId: number): boolean {
  return inFlight.has(taskId);
}

/**
 * Clear the registry (tests only).
 */
export function resetVerifyCompletionRegistry(): void {
  inFlight.clear();
}

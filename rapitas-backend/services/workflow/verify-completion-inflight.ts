/**
 * Verify Completion In-Flight Registry
 *
 * Tracks the commit / PR / merge automation running for a task after its
 * verify.md was saved, so the WorkflowRunner can wait for the real outcome
 * instead of guessing with a fixed grace window.
 *
 * The runner polls a `verify_done` task and, once its window expires, declares
 * the completion gate failed. That window was a blind 60s guess while the
 * automation itself is unbounded work (scoped tests, git push, `gh pr create`
 * over the network). Task 580 finished in 127s: the runner marked it failed at
 * ~70s and auto-run SKIPPED it, then the pipeline created PR #7 57s later — a
 * successful task left parked as blocked with an unlinked PR.
 *
 * Same process as the save handler (the runner calls the HTTP pipeline
 * in-process), so a module-level registry is enough. Mirrors
 * phase-critic/critic-inflight.ts. Not responsible for running or judging the
 * automation — only for reporting that it is still working.
 */

/** Tasks whose post-verify automation is currently running. */
const inFlight = new Map<number, Promise<unknown>>();

/**
 * Register a task's running commit/PR automation. The entry removes itself on
 * settlement, and only when it is still the current entry — a newer run for the
 * same task must not be deleted by an older one settling late.
 *
 * @param taskId - Task whose automation started. / 対象タスクID
 * @param work - Promise that settles when the automation finishes. / 完了時に解決するPromise
 */
export function registerVerifyCompletion(taskId: number, work: Promise<unknown>): void {
  inFlight.set(taskId, work);
  void work
    .catch(() => {})
    .finally(() => {
      if (inFlight.get(taskId) === work) inFlight.delete(taskId);
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

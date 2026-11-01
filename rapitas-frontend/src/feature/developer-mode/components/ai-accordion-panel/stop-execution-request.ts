/**
 * StopExecutionRequest
 *
 * Asks the backend to stop a task's execution and says what actually happened.
 * Not responsible for any UI state — the hook decides what to do with the
 * outcome.
 *
 * Why this exists (#1330 review): the hook marked the execution stopped and
 * cancelled polling BEFORE sending the request, read nothing from the
 * response, and logged a network failure without telling anyone. So the UI
 * showed "stopped" whatever happened — including when the execution was still
 * running — and the backend's `statusResetFailed` flag, added in the same
 * issue, had no reader. A signal nobody consumes is not a fix.
 */

/** What a stop attempt actually achieved. */
export type StopExecutionOutcome =
  /** Stopped, and the task's status was reset. */
  | { kind: 'stopped' }
  /**
   * The executions were stopped, but the task's status could not be reset, so
   * it is still sitting in its previous state. Not a failure — but not clean,
   * and the person looking at the screen needs to know.
   */
  | { kind: 'stopped_with_warning'; serverMessage?: string }
  /** Nothing was stopped. The execution may still be running. */
  | { kind: 'failed' };

/** The shape of the stop endpoint's reply that this cares about. */
interface StopResponseBody {
  success?: boolean;
  statusResetFailed?: boolean;
  message?: string;
}

/**
 * Stop the execution(s) for one task.
 *
 * Falls back to the session-level stop when the task-level call is rejected,
 * which is what the hook did before — kept, because a session that answers
 * when the task route does not is still a successful stop.
 *
 * @param options - Task, optional session, API base and an injectable fetch / 対象と注入可能な fetch
 * @returns What the attempt achieved / 試行の結果
 */
export async function requestStopExecution(options: {
  taskId: number | string;
  /** Number in the hook, string in the URL — both are accepted. */
  sessionId?: string | number | null;
  apiBaseUrl: string;
  fetchFn?: typeof fetch;
}): Promise<StopExecutionOutcome> {
  const { taskId, sessionId, apiBaseUrl } = options;
  const doFetch = options.fetchFn ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${apiBaseUrl}/tasks/${taskId}/stop-execution`, { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }

  if (!res.ok) {
    if (!sessionId) return { kind: 'failed' };
    try {
      const fallback = await doFetch(`${apiBaseUrl}/agents/sessions/${sessionId}/stop`, {
        method: 'POST',
      });
      return fallback.ok ? { kind: 'stopped' } : { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }

  // A body that cannot be parsed is not a reason to call a 2xx a failure; the
  // stop endpoint answers 200 for the stop itself.
  let body: StopResponseBody = {};
  try {
    body = (await res.json()) as StopResponseBody;
  } catch {
    return { kind: 'stopped' };
  }

  if (body.statusResetFailed === true) {
    return { kind: 'stopped_with_warning', serverMessage: body.message };
  }
  return { kind: 'stopped' };
}

/**
 * Whether an outcome means the execution is no longer running.
 *
 * A type guard rather than a plain boolean, so the caller's `!didStop(...)`
 * branch narrows to the failed variant and can read its message.
 *
 * @param outcome - What the stop attempt achieved / 停止試行の結果
 * @returns true when the execution stopped, cleanly or with a warning / 停止したか
 */
export function didStop(
  outcome: StopExecutionOutcome,
): outcome is Exclude<StopExecutionOutcome, { kind: 'failed' }> {
  return outcome.kind !== 'failed';
}

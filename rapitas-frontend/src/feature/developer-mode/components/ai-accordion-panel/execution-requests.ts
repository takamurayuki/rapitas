/**
 * ExecutionRequests
 *
 * The backend calls the execution panel makes besides the stop request: base
 * branch loading, branch-name generation and answering an agent's question.
 * Each returns what happened and nothing else — no React state, no logging
 * side effects, so the hook stays the only place that decides what to show.
 *
 * Extracted from `useExecutionManager.ts`, which crossed the 500-line hard
 * limit. `stop-execution-request.ts` is kept separate: its outcome type is
 * what the review's stop fix turns on, and it carries its own tests.
 */

/** Branches a feature branch may be cut from, as the task route reports them. */
export interface BaseBranchOptions {
  branches: string[];
  defaultBranch: string | null;
}

/**
 * Load the branches this task's work may branch from.
 *
 * @param options - Task, API base and an injectable fetch / 対象と注入可能な fetch
 * @returns The options, or null when they could not be read / 取得できなければ null
 */
export async function fetchBaseBranchOptions(options: {
  taskId: number | string;
  apiBaseUrl: string;
  fetchFn?: typeof fetch;
}): Promise<BaseBranchOptions | null> {
  const doFetch = options.fetchFn ?? fetch;
  try {
    const res = await doFetch(`${options.apiBaseUrl}/tasks/${options.taskId}/base-branches`);
    if (!res.ok) return null;
    const data = (await res.json()) as { branches?: string[]; defaultBranch?: string | null };
    return { branches: data.branches ?? [], defaultBranch: data.defaultBranch ?? null };
  } catch {
    // Non-critical: the field falls back to the theme default server-side.
    return null;
  }
}

/** A branch name suggestion, or why there is none. */
export type BranchNameOutcome =
  | { kind: 'generated'; branchName: string }
  | { kind: 'failed'; reason: string };

/**
 * Ask the backend for a branch name for this task.
 *
 * @param options - Title, optional description, API base and an injectable fetch / 生成元と注入可能な fetch
 * @returns The suggested name, or the reason none came back / 生成結果
 */
export async function generateBranchName(options: {
  title: string;
  description?: string | null;
  apiBaseUrl: string;
  fetchFn?: typeof fetch;
}): Promise<BranchNameOutcome> {
  const doFetch = options.fetchFn ?? fetch;
  try {
    const res = await doFetch(`${options.apiBaseUrl}/developer-mode/generate-branch-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: options.title,
        description: options.description || undefined,
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      branchName?: string;
      error?: string;
      details?: string;
    } | null;

    if (res.ok && data?.branchName) return { kind: 'generated', branchName: data.branchName };
    return { kind: 'failed', reason: data?.error || data?.details || `HTTP ${res.status}` };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Send the user's answer to an agent that is waiting for input.
 *
 * Reads the body's own `success` rather than trusting the status: the route
 * used to answer 200 for rejected requests (no active session, execution not
 * waiting, lock contention), which the caller read as "resumed". The statuses
 * are correct now, but the body is the authority either way.
 *
 * @param options - Task, the answer, API base and an injectable fetch / 送信内容と注入可能な fetch
 * @returns true when the agent accepted the answer / 受理されたか
 */
export async function sendAgentResponse(options: {
  taskId: number | string;
  response: string;
  apiBaseUrl: string;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  const doFetch = options.fetchFn ?? fetch;
  try {
    const res = await doFetch(`${options.apiBaseUrl}/tasks/${options.taskId}/agent-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: options.response }),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return res.ok && body?.success === true;
  } catch {
    return false;
  }
}

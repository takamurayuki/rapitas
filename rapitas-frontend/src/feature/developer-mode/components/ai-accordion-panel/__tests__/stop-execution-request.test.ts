/**
 * stop-execution-request.test
 *
 * Flagged in the #1330 review: the backend gained a `statusResetFailed` flag
 * and the UI never read it, while `setPollingCancelled()` ran BEFORE the
 * request — so the panel said "stopped" whatever came back, including when the
 * request failed and the execution was still running.
 *
 * These pin the outcome the hook now branches on.
 */
import { describe, expect, it, vi } from 'vitest';
import { didStop, requestStopExecution } from '../stop-execution-request';

const API = 'http://api.test';

/** A fetch stand-in that answers each call from a queue. */
function fetchQueue(...responses: Array<Response | Error>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string | URL) => {
    calls.push(String(url));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? new Response('{}', { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('a clean stop', () => {
  it('reports stopped', async () => {
    const { fn, calls } = fetchQueue(json({ success: true, stoppedCount: 1 }));

    const outcome = await requestStopExecution({ taskId: 7, apiBaseUrl: API, fetchFn: fn });

    expect(outcome).toEqual({ kind: 'stopped' });
    expect(calls[0]).toBe(`${API}/tasks/7/stop-execution`);
  });

  it('reports stopped when the body cannot be parsed', async () => {
    // A 2xx with an unreadable body is still a stop; the endpoint answers 200
    // for the stop itself.
    const { fn } = fetchQueue(new Response('not json', { status: 200 }));

    expect(await requestStopExecution({ taskId: 7, apiBaseUrl: API, fetchFn: fn })).toEqual({
      kind: 'stopped',
    });
  });
});

describe('a stop whose status reset failed', () => {
  it('is reported as a warning, not as success', async () => {
    const { fn } = fetchQueue(json({ success: true, statusResetFailed: true }));

    const outcome = await requestStopExecution({ taskId: 7, apiBaseUrl: API, fetchFn: fn });

    expect(outcome.kind).toBe('stopped_with_warning');
    // The execution DID stop, so the panel should still leave the running
    // state — the warning is about the task's status, not the stop.
    expect(didStop(outcome)).toBe(true);
  });

  it("carries the server's own message through when it sent one", async () => {
    const { fn } = fetchQueue(
      json({ success: true, statusResetFailed: true, message: 'サーバー側の説明' }),
    );

    const outcome = await requestStopExecution({ taskId: 7, apiBaseUrl: API, fetchFn: fn });

    expect(outcome).toEqual({ kind: 'stopped_with_warning', serverMessage: 'サーバー側の説明' });
  });

  it('leaves the wording to the panel when the server sent none', async () => {
    // No sentence is built here: the UI is translated, so the module reports
    // a code and the panel renders `t('stopResetFailed')`.
    const { fn } = fetchQueue(json({ statusResetFailed: true }));

    const outcome = await requestStopExecution({ taskId: 7, apiBaseUrl: API, fetchFn: fn });

    expect(outcome).toEqual({ kind: 'stopped_with_warning', serverMessage: undefined });
  });
});

describe('a stop that did not happen', () => {
  // The case the review called out: the panel showed stopped while the
  // execution was still running.
  it('reports failure when the request throws', async () => {
    const { fn } = fetchQueue(new Error('network down'));

    const outcome = await requestStopExecution({ taskId: 7, apiBaseUrl: API, fetchFn: fn });

    expect(outcome.kind).toBe('failed');
    expect(didStop(outcome)).toBe(false);
  });

  it('reports failure on a non-ok reply with no session to fall back to', async () => {
    const { fn } = fetchQueue(json({ error: 'boom' }, 500));

    expect((await requestStopExecution({ taskId: 7, apiBaseUrl: API, fetchFn: fn })).kind).toBe(
      'failed',
    );
  });
});

describe('the session-level fallback', () => {
  it('is tried when the task-level stop is rejected, and counts as stopped', async () => {
    const { fn, calls } = fetchQueue(json({ error: 'boom' }, 500), json({ success: true }));

    const outcome = await requestStopExecution({
      taskId: 7,
      sessionId: 'sess-1',
      apiBaseUrl: API,
      fetchFn: fn,
    });

    expect(outcome).toEqual({ kind: 'stopped' });
    expect(calls[1]).toBe(`${API}/agents/sessions/sess-1/stop`);
  });

  it('reports failure when the fallback is rejected too', async () => {
    const { fn } = fetchQueue(json({}, 500), json({}, 500));

    const outcome = await requestStopExecution({
      taskId: 7,
      sessionId: 'sess-1',
      apiBaseUrl: API,
      fetchFn: fn,
    });

    expect(outcome.kind).toBe('failed');
  });

  it('reports failure when the fallback throws', async () => {
    const { fn } = fetchQueue(json({}, 500), new Error('network down'));

    const outcome = await requestStopExecution({
      taskId: 7,
      sessionId: 'sess-1',
      apiBaseUrl: API,
      fetchFn: fn,
    });

    expect(outcome.kind).toBe('failed');
  });

  it('is not tried when the task-level stop succeeded', async () => {
    const { fn, calls } = fetchQueue(json({ success: true }));

    await requestStopExecution({ taskId: 7, sessionId: 'sess-1', apiBaseUrl: API, fetchFn: fn });

    expect(calls).toHaveLength(1);
  });
});

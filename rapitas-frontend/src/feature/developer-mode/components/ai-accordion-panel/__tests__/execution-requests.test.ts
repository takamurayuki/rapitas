/**
 * execution-requests.test
 *
 * These three calls were inline in `useExecutionManager.ts` and had no tests.
 * Two of them silently treat a rejection as success unless the body is read,
 * which is the class of bug the #1330 review found in the stop path — so the
 * behaviour is pinned here now that it has its own module.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fetchBaseBranchOptions,
  generateBranchName,
  sendAgentResponse,
} from '../execution-requests';

const API = 'http://api.test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch stand-in that answers once, recording the URL and init it saw. */
function once(response: Response | Error) {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    if (response instanceof Error) throw response;
    return response;
  });
  return { fn: fn as unknown as typeof fetch, seen };
}

describe('fetchBaseBranchOptions', () => {
  it('returns the branches and the default', async () => {
    const { fn, seen } = once(json({ branches: ['main', 'develop'], defaultBranch: 'develop' }));

    expect(await fetchBaseBranchOptions({ taskId: 7, apiBaseUrl: API, fetchFn: fn })).toEqual({
      branches: ['main', 'develop'],
      defaultBranch: 'develop',
    });
    expect(seen[0].url).toBe(`${API}/tasks/7/base-branches`);
  });

  it('fills in the missing fields rather than returning undefined', async () => {
    const { fn } = once(json({}));

    expect(await fetchBaseBranchOptions({ taskId: 7, apiBaseUrl: API, fetchFn: fn })).toEqual({
      branches: [],
      defaultBranch: null,
    });
  });

  it('returns null on a rejection and on a network failure', async () => {
    const rejected = once(json({ error: 'nope' }, 500));
    expect(
      await fetchBaseBranchOptions({ taskId: 7, apiBaseUrl: API, fetchFn: rejected.fn }),
    ).toBeNull();

    const broken = once(new Error('network down'));
    expect(
      await fetchBaseBranchOptions({ taskId: 7, apiBaseUrl: API, fetchFn: broken.fn }),
    ).toBeNull();
  });
});

describe('generateBranchName', () => {
  it('returns the suggested name', async () => {
    const { fn, seen } = once(json({ branchName: 'feature/7-thing' }));

    expect(await generateBranchName({ title: 'Thing', apiBaseUrl: API, fetchFn: fn })).toEqual({
      kind: 'generated',
      branchName: 'feature/7-thing',
    });
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ title: 'Thing' });
  });

  it('omits an empty description instead of sending it', async () => {
    const { fn, seen } = once(json({ branchName: 'x' }));

    await generateBranchName({ title: 'T', description: '', apiBaseUrl: API, fetchFn: fn });

    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ title: 'T' });
  });

  it('fails when the reply is 2xx but carries no name', async () => {
    // A 200 with no branchName left the field untouched and silent before.
    const { fn } = once(json({}));

    const outcome = await generateBranchName({ title: 'T', apiBaseUrl: API, fetchFn: fn });

    expect(outcome.kind).toBe('failed');
  });

  it("reports the server's reason, then the status, then the thrown error", async () => {
    const withError = once(json({ error: 'quota' }, 400));
    expect(
      await generateBranchName({ title: 'T', apiBaseUrl: API, fetchFn: withError.fn }),
    ).toEqual({ kind: 'failed', reason: 'quota' });

    const bare = once(new Response('not json', { status: 503 }));
    expect(await generateBranchName({ title: 'T', apiBaseUrl: API, fetchFn: bare.fn })).toEqual({
      kind: 'failed',
      reason: 'HTTP 503',
    });

    const broken = once(new Error('network down'));
    expect(await generateBranchName({ title: 'T', apiBaseUrl: API, fetchFn: broken.fn })).toEqual({
      kind: 'failed',
      reason: 'network down',
    });
  });
});

describe('sendAgentResponse', () => {
  it('accepts only a 2xx whose body says success', async () => {
    const { fn, seen } = once(json({ success: true }));

    expect(
      await sendAgentResponse({ taskId: 7, response: 'はい', apiBaseUrl: API, fetchFn: fn }),
    ).toBe(true);
    expect(seen[0].url).toBe(`${API}/tasks/7/agent-respond`);
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ response: 'はい' });
  });

  it('rejects a 200 that does not say success', async () => {
    // The route used to answer 200 for "no active session" — read as resumed.
    const { fn } = once(json({ error: 'no active session' }));

    expect(
      await sendAgentResponse({ taskId: 7, response: 'x', apiBaseUrl: API, fetchFn: fn }),
    ).toBe(false);
  });

  it('rejects an error status, an unparsable body and a network failure', async () => {
    const failed = once(json({ success: true }, 409));
    expect(
      await sendAgentResponse({ taskId: 7, response: 'x', apiBaseUrl: API, fetchFn: failed.fn }),
    ).toBe(false);

    const garbage = once(new Response('not json', { status: 200 }));
    expect(
      await sendAgentResponse({ taskId: 7, response: 'x', apiBaseUrl: API, fetchFn: garbage.fn }),
    ).toBe(false);

    const broken = once(new Error('network down'));
    expect(
      await sendAgentResponse({ taskId: 7, response: 'x', apiBaseUrl: API, fetchFn: broken.fn }),
    ).toBe(false);
  });
});

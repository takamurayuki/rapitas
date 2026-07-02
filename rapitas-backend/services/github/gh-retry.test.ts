/**
 * gh-retry.test
 *
 * Tests for GitHub error classifier, retry policy presets, exponential backoff,
 * head-behind helpers, and the withGhRetry orchestrator.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// NOTE: sleep is mocked to a no-op so tests do not incur real timer delays.
// All exports from agent-retry must be mirrored — bun mock.module is process-global.
const mockSleep = mock((_ms: number) => Promise.resolve());

mock.module('../agents/abstraction/agent-retry', () => ({
  sleep: mockSleep,
  evaluateRetry: mock(async () => ({ shouldRetry: false, delay: 0 })),
  executeWithRetry: mock(async () => ({})),
  continueWithRetry: mock(async () => ({})),
}));

const {
  classifyGitHubError,
  withGhRetry,
  READ_RETRY_POLICY,
  WRITE_RETRY_POLICY,
  POLL_RETRY_POLICY,
  isHeadBehindError,
  isAlreadyUpToDate,
  computeBackoffDelay,
} = await import('./gh-retry');

// ---------------------------------------------------------------------------
// classifyGitHubError
// ---------------------------------------------------------------------------

describe('classifyGitHubError', () => {
  it.each([
    { name: 'API rate limit exceeded', input: 'API rate limit exceeded' },
    {
      name: 'secondary rate limit (GitHub secondary)',
      input: 'You have exceeded a secondary rate limit',
    },
    { name: '403 with rate limit text', input: 'HTTP 403 rate limit' },
  ])('rate_limit: $name', ({ input }) => {
    expect(classifyGitHubError(input)).toBe('rate_limit');
  });

  it.each([
    { name: 'ETIMEDOUT', input: 'ETIMEDOUT connect failed' },
    { name: 'ECONNRESET', input: 'ECONNRESET connection was reset' },
    { name: '502 gateway error', input: '502 Bad Gateway' },
    { name: '504 timeout', input: '504 Gateway Timeout' },
  ])('transient: $name', ({ input }) => {
    expect(classifyGitHubError(input)).toBe('transient');
  });

  it.each([
    {
      name: 'not up to date with the base branch',
      input: 'not up to date with the base branch',
    },
    { name: 'not mergeable', input: 'not mergeable' },
    { name: 'base branch was modified', input: 'base branch was modified' },
  ])('head_behind: $name', ({ input }) => {
    expect(classifyGitHubError(input)).toBe('head_behind');
  });

  it('auth: bad credentials', () => {
    expect(classifyGitHubError('bad credentials')).toBe('auth');
  });

  it('auth: not authenticated', () => {
    expect(classifyGitHubError('not authenticated')).toBe('auth');
  });

  it('auth: HTTP 401', () => {
    expect(classifyGitHubError('HTTP 401 Unauthorized')).toBe('auth');
  });

  it('not_found: 404 not found', () => {
    expect(classifyGitHubError('HTTP 404 Not Found')).toBe('not_found');
  });

  it('not_found: no pull requests found', () => {
    expect(classifyGitHubError('no pull requests found')).toBe('not_found');
  });

  it('unrecoverable: unrecognized message defaults to unrecoverable', () => {
    expect(classifyGitHubError('something completely unexpected happened')).toBe('unrecoverable');
  });

  it('unrecoverable: empty string defaults to unrecoverable', () => {
    expect(classifyGitHubError('')).toBe('unrecoverable');
  });

  it('auth takes priority over rate_limit when both patterns could match', () => {
    // "not authenticated" (auth rule) appears before the 403 rate_limit rule
    expect(classifyGitHubError('not authenticated: HTTP 403 rate limit')).toBe('auth');
  });
});

// ---------------------------------------------------------------------------
// Policy presets
// ---------------------------------------------------------------------------

describe('policy presets', () => {
  it('READ_RETRY_POLICY retries rate_limit and transient', () => {
    expect(READ_RETRY_POLICY.retryOn).toContain('rate_limit');
    expect(READ_RETRY_POLICY.retryOn).toContain('transient');
    expect(READ_RETRY_POLICY.maxRetries).toBe(3);
    expect(READ_RETRY_POLICY.baseDelay).toBe(1000);
    expect(READ_RETRY_POLICY.maxDelay).toBe(30000);
  });

  it('WRITE_RETRY_POLICY retries rate_limit only (not transient)', () => {
    expect(WRITE_RETRY_POLICY.retryOn).toContain('rate_limit');
    expect(WRITE_RETRY_POLICY.retryOn).not.toContain('transient');
    expect(WRITE_RETRY_POLICY.maxRetries).toBe(2);
    expect(WRITE_RETRY_POLICY.baseDelay).toBe(2000);
    expect(WRITE_RETRY_POLICY.maxDelay).toBe(30000);
  });

  it('POLL_RETRY_POLICY caps maxDelay at 8000 ms', () => {
    expect(POLL_RETRY_POLICY.retryOn).toContain('rate_limit');
    expect(POLL_RETRY_POLICY.retryOn).toContain('transient');
    expect(POLL_RETRY_POLICY.maxRetries).toBe(2);
    expect(POLL_RETRY_POLICY.baseDelay).toBe(500);
    expect(POLL_RETRY_POLICY.maxDelay).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// computeBackoffDelay
// ---------------------------------------------------------------------------

describe('computeBackoffDelay', () => {
  it('attempt=0: result in [base, base + base*0.3)', () => {
    for (let i = 0; i < 30; i++) {
      const d = computeBackoffDelay(0, 1000, 30000);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThan(1300);
    }
  });

  it('attempt=1: result in [2000, 2300)', () => {
    for (let i = 0; i < 30; i++) {
      const d = computeBackoffDelay(1, 1000, 30000);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThan(2300);
    }
  });

  it('clamps exponential at maxDelay and adds jitter up to base*0.3', () => {
    // attempt=10: base*2^10 = 1,024,000 >> maxDelay=30000; clamped=30000
    for (let i = 0; i < 30; i++) {
      const d = computeBackoffDelay(10, 1000, 30000);
      expect(d).toBeGreaterThanOrEqual(30000);
      expect(d).toBeLessThan(30300);
    }
  });
});

// ---------------------------------------------------------------------------
// withGhRetry
// ---------------------------------------------------------------------------

describe('withGhRetry', () => {
  beforeEach(() => {
    mockSleep.mockClear();
  });

  it('success on first attempt — no sleep called', async () => {
    const fn = mock(() => Promise.resolve('ok'));

    const result = await withGhRetry(fn, READ_RETRY_POLICY);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('1 failure (rate_limit) then success — retries once with READ policy', async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('API rate limit exceeded'));
      return Promise.resolve('retried-ok');
    });

    const result = await withGhRetry(fn, READ_RETRY_POLICY);

    expect(result).toBe('retried-ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
  });

  it('exhausts maxRetries=3 — re-throws last error after 4 total calls', async () => {
    const fn = mock(() => Promise.reject(new Error('API rate limit exceeded')));

    await expect(withGhRetry(fn, READ_RETRY_POLICY)).rejects.toThrow('API rate limit exceeded');
    // 1 initial + 3 retries = 4 total; 3 sleeps (before each retry)
    expect(fn).toHaveBeenCalledTimes(4);
    expect(mockSleep).toHaveBeenCalledTimes(3);
  });

  it('auth error — throws immediately, no retry', async () => {
    const fn = mock(() => Promise.reject(new Error('bad credentials')));

    await expect(withGhRetry(fn, READ_RETRY_POLICY)).rejects.toThrow('bad credentials');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('unrecoverable error — throws immediately, no retry', async () => {
    const fn = mock(() => Promise.reject(new Error('something completely unexpected')));

    await expect(withGhRetry(fn, READ_RETRY_POLICY)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('transient error with WRITE_RETRY_POLICY — no retry (transient not in retryOn)', async () => {
    const fn = mock(() => Promise.reject(new Error('ETIMEDOUT connect ETIMEDOUT')));

    await expect(withGhRetry(fn, WRITE_RETRY_POLICY)).rejects.toThrow('ETIMEDOUT');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('rate_limit with WRITE_RETRY_POLICY — retries up to maxRetries=2', async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls <= 2) return Promise.reject(new Error('API rate limit exceeded'));
      return Promise.resolve('write-ok');
    });

    const result = await withGhRetry(fn, WRITE_RETRY_POLICY);

    expect(result).toBe('write-ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
  });

  it('head_behind with READ policy — not in retryOn, throws immediately', async () => {
    const fn = mock(() => Promise.reject(new Error('not up to date with the base branch')));

    await expect(withGhRetry(fn, READ_RETRY_POLICY)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('not_found with READ policy — not in retryOn, throws immediately', async () => {
    const fn = mock(() => Promise.reject(new Error('HTTP 404 Not Found')));

    await expect(withGhRetry(fn, READ_RETRY_POLICY)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('uses READ_RETRY_POLICY by default', async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve('default-policy-ok');
    });

    // No explicit policy — should default to READ_RETRY_POLICY (transient retried)
    const result = await withGhRetry(fn);

    expect(result).toBe('default-policy-ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// isHeadBehindError
// ---------------------------------------------------------------------------

describe('isHeadBehindError', () => {
  it.each([
    {
      name: 'true for "not up to date with the base branch"',
      input: 'not up to date with the base branch',
      expected: true,
    },
    {
      name: 'true for "not up-to-date with the base branch" (hyphenated)',
      input: 'not up-to-date with the base branch',
      expected: true,
    },
    { name: 'true for "not mergeable"', input: 'not mergeable', expected: true },
    {
      name: 'true for "base branch was modified"',
      input: 'base branch was modified',
      expected: true,
    },
    { name: 'false for rate_limit error', input: 'API rate limit exceeded', expected: false },
    { name: 'false for unrelated error', input: 'bad credentials', expected: false },
    { name: 'false for empty string', input: '', expected: false },
  ])('returns $name', ({ input, expected }) => {
    expect(isHeadBehindError(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isAlreadyUpToDate
// ---------------------------------------------------------------------------

describe('isAlreadyUpToDate', () => {
  it.each([
    { name: 'true for "already up to date"', input: 'already up to date', expected: true },
    {
      name: 'true for "already up-to-date" (hyphenated)',
      input: 'already up-to-date',
      expected: true,
    },
    { name: 'true for "no new commits"', input: 'no new commits', expected: true },
    { name: 'true for "not behind"', input: 'not behind', expected: true },
    { name: 'false for unrelated error', input: 'something else failed', expected: false },
    { name: 'false for empty string', input: '', expected: false },
  ])('returns $name', ({ input, expected }) => {
    expect(isAlreadyUpToDate(input)).toBe(expected);
  });
});

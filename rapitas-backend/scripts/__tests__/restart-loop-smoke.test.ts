/**
 * restart-loop-smoke.test
 *
 * Unit tests for the pure functions in restart-loop-smoke.ts.
 * Network I/O and subprocess calls are injected via parameters so no real
 * server is started here. Integration coverage (actual spawn → health) is
 * provided by the E2E smoke run in CI (e2e.yml).
 */

import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import {
  assertNotPort3001,
  parseLsofPids,
  waitForHealth,
  waitForPortFree,
  isAllCyclesPassed,
  renderSmokeMarkdown,
  type CycleResult,
} from '../restart-loop-smoke';

// ---------------------------------------------------------------------------
// assertNotPort3001
// ---------------------------------------------------------------------------

describe('assertNotPort3001', () => {
  afterEach(() => {
    // Ensure exit spy is restored after each test
  });

  it('does not exit for a safe port', () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('unexpected exit');
    }) as typeof process.exit);

    expect(() => assertNotPort3001(3210)).not.toThrow();

    exitSpy.mockRestore();
  });

  it('exits with code 1 for port 3001', () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit:1');
    }) as typeof process.exit);

    expect(() => assertNotPort3001(3001)).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('exits with code 1 for port 3000', () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit:1');
    }) as typeof process.exit);

    expect(() => assertNotPort3001(3000)).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// parseLsofPids
// ---------------------------------------------------------------------------

describe('parseLsofPids', () => {
  it('parses a single PID', () => {
    expect(parseLsofPids('12345\n')).toEqual([12345]);
  });

  it('parses multiple PIDs', () => {
    expect(parseLsofPids('100\n200\n300')).toEqual([100, 200, 300]);
  });

  it('returns empty array for empty output (port free)', () => {
    expect(parseLsofPids('')).toEqual([]);
    expect(parseLsofPids('\n')).toEqual([]);
  });

  it('ignores non-numeric lines', () => {
    expect(parseLsofPids('abc\n999\n')).toEqual([999]);
  });

  it('ignores zero and negative values', () => {
    expect(parseLsofPids('0\n-1\n500')).toEqual([500]);
  });

  it('trims whitespace from each line', () => {
    expect(parseLsofPids('  42  \n  7  ')).toEqual([42, 7]);
  });
});

// ---------------------------------------------------------------------------
// waitForHealth
// ---------------------------------------------------------------------------

describe('waitForHealth', () => {
  // eslint-disable-next-line local/prefer-test-each-for-similar -- mocks differ in structure (stateless response vs stateful call-counter vs always-throwing) and each case asserts a different subset of result fields, so a shared table would need per-case escape hatches that hurt clarity
  it('returns ok=true when /health responds with status "healthy"', async () => {
    const mockFetch = async (_url: string) =>
      new Response(JSON.stringify({ status: 'healthy' }), { status: 200 });

    const result = await waitForHealth(3210, 5000, 0, mockFetch);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=true on second attempt after initial failure', async () => {
    let calls = 0;
    const mockFetch = async (_url: string) => {
      calls++;
      if (calls < 2) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ status: 'healthy' }), { status: 200 });
    };

    const result = await waitForHealth(3210, 5000, 0, mockFetch);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns ok=false when status is "unhealthy"', async () => {
    const mockFetch = async (_url: string) =>
      new Response(JSON.stringify({ status: 'unhealthy' }), { status: 503 });

    // Use very short timeout to not block the test suite
    const result = await waitForHealth(3210, 50, 0, mockFetch);

    expect(result.ok).toBe(false);
  });

  it('returns ok=false when fetch always throws (timeout)', async () => {
    const mockFetch = async (_url: string) => {
      throw new Error('ECONNREFUSED');
    };

    const result = await waitForHealth(3210, 50, 0, mockFetch);

    expect(result.ok).toBe(false);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('polls until timeout when server never becomes healthy', async () => {
    let calls = 0;
    const mockFetch = async (_url: string) => {
      calls++;
      return new Response(JSON.stringify({ status: 'starting' }), { status: 200 });
    };

    const result = await waitForHealth(3210, 30, 5, mockFetch);

    expect(result.ok).toBe(false);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// waitForPortFree
// ---------------------------------------------------------------------------

describe('waitForPortFree', () => {
  // eslint-disable-next-line local/prefer-test-each-for-similar -- mocks differ in structure (stateless always-true/false vs stateful call-counter) and each case asserts a different subset of result fields (elapsedMs vs exact call count), so a shared table would need per-case escape hatches that hurt clarity
  it('returns free=true immediately when port is already free', async () => {
    const alwaysFree = async (_port: number) => true;

    const result = await waitForPortFree(3210, 5000, 0, alwaysFree);

    expect(result.free).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('returns free=true after port becomes free on second attempt', async () => {
    let calls = 0;
    const eventuallFree = async (_port: number) => {
      calls++;
      return calls >= 2;
    };

    const result = await waitForPortFree(3210, 5000, 5, eventuallFree);

    expect(result.free).toBe(true);
    expect(calls).toBe(2);
  });

  it('returns free=false when port never frees within timeout', async () => {
    const neverFree = async (_port: number) => false;

    const result = await waitForPortFree(3210, 30, 5, neverFree);

    expect(result.free).toBe(false);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// isAllCyclesPassed
// ---------------------------------------------------------------------------

describe('isAllCyclesPassed', () => {
  const pass = (cycle: number): CycleResult => ({
    cycle,
    healthOk: true,
    portFreeMs: 50,
    healthMs: 1200,
  });

  const fail = (cycle: number, error: string): CycleResult => ({
    cycle,
    healthOk: false,
    portFreeMs: null,
    healthMs: null,
    error,
  });

  const passWithError = (cycle: number): CycleResult => ({
    cycle,
    healthOk: true,
    portFreeMs: null,
    healthMs: 1500,
    error: 'Ghost socket detected',
  });

  it.each([
    {
      name: 'returns true when all cycles pass',
      cycles: [pass(1), pass(2), pass(3)],
      expected: true,
    },
    {
      name: 'returns false when any cycle has healthOk=false',
      cycles: [pass(1), fail(2, 'timeout'), pass(3)],
      expected: false,
    },
    {
      name: 'returns false when a cycle has an error (e.g. ghost socket)',
      cycles: [pass(1), passWithError(2)],
      expected: false,
    },
    {
      name: 'returns false for empty array (no cycles ran)',
      cycles: [] as CycleResult[],
      expected: false,
    },
    {
      name: 'returns true for a single successful cycle',
      cycles: [pass(1)],
      expected: true,
    },
  ])('$name', ({ cycles, expected }) => {
    expect(isAllCyclesPassed(cycles)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// renderSmokeMarkdown
// ---------------------------------------------------------------------------

describe('renderSmokeMarkdown', () => {
  const allPass: CycleResult[] = [
    { cycle: 1, healthOk: true, portFreeMs: 45, healthMs: 1300 },
    { cycle: 2, healthOk: true, portFreeMs: 38, healthMs: 1100 },
    { cycle: 3, healthOk: true, portFreeMs: 52, healthMs: 1250 },
  ];

  const withFailure: CycleResult[] = [
    { cycle: 1, healthOk: true, portFreeMs: 45, healthMs: 1300 },
    {
      cycle: 2,
      healthOk: false,
      portFreeMs: null,
      healthMs: null,
      error: 'Health timeout after 30000ms (60 attempts)',
    },
    { cycle: 3, healthOk: true, portFreeMs: 38, healthMs: 1100 },
  ];

  it.each([
    {
      name: 'includes PASSED badge when all cycles succeed',
      data: allPass,
      contains: ['✅ PASSED'],
      notContains: ['❌ FAILED'],
    },
    {
      name: 'includes FAILED badge when any cycle fails',
      data: withFailure,
      contains: ['❌ FAILED'],
      notContains: ['✅ PASSED'],
    },
    {
      name: 'includes the port number',
      data: allPass,
      contains: ['3210'],
      notContains: [] as string[],
    },
  ])('$name', ({ data, contains, notContains }) => {
    const md = renderSmokeMarkdown(data, 3210);
    contains.forEach((s) => expect(md).toContain(s));
    notContains.forEach((s) => expect(md).not.toContain(s));
  });

  // eslint-disable-next-line local/prefer-test-each-for-similar -- each case has distinct setup (own local `results` arrays vs shared consts) and differently-shaped assertions (table-row slicing, regex counting, truncation checks); forcing a shared table would obscure each check rather than clarify it
  it('renders a Markdown table header', () => {
    const md = renderSmokeMarkdown(allPass, 3210);
    expect(md).toContain('| サイクル |');
    expect(md).toContain('|----------|');
  });

  it('renders ✅ for passing cycles and ❌ for failing cycles', () => {
    const md = renderSmokeMarkdown(withFailure, 3210);
    // cycle 1 and 3 pass, cycle 2 fails
    // The separator row (|---|) does not start with '| ', so only the column
    // header row and data rows are matched by this filter.
    const rows = md.split('\n').filter((l) => l.startsWith('| '));
    // rows[0] = column header; rows[1..] = data rows
    const dataRows = rows.slice(1);
    expect(dataRows[0]).toContain('✅');
    expect(dataRows[1]).toContain('❌');
    expect(dataRows[2]).toContain('✅');
  });

  it('renders error text truncated to 60 chars in the notes column', () => {
    const longError = 'A'.repeat(100);
    const results: CycleResult[] = [
      { cycle: 1, healthOk: false, portFreeMs: null, healthMs: null, error: longError },
    ];
    const md = renderSmokeMarkdown(results, 3210);
    expect(md).toContain('A'.repeat(60));
    // Should not contain the full 100-char error in a single note cell
    expect(md).not.toContain('A'.repeat(61));
  });

  it('renders "—" for null portFreeMs and healthMs', () => {
    const results: CycleResult[] = [
      { cycle: 1, healthOk: false, portFreeMs: null, healthMs: null, error: 'timeout' },
    ];
    const md = renderSmokeMarkdown(results, 3210);
    // "| — " matches the start of each dash cell (pipe + space + dash + space).
    // The pattern occurs twice in "| — | — |" because the closing pipe of the
    // first cell is also the opening pipe of the second cell, so a non-overlapping
    // regex starting at the next character still finds the second match.
    const count = (md.match(/\| — /g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('shows correct success count in summary line', () => {
    const md = renderSmokeMarkdown(withFailure, 3210);
    // 2 out of 3 cycles pass (cycle 1 and 3)
    expect(md).toContain('成功: 2');
  });

  it('ends with a trailing newline', () => {
    const md = renderSmokeMarkdown(allPass, 3210);
    expect(md.endsWith('\n')).toBe(true);
  });
});

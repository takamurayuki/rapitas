/**
 * runtime-smoke unit tests
 *
 * Verifies runtime-config parsing/validation, port substitution, the pure
 * smoke-verdict logic, free-port allocation, and that a project without
 * rapitas.runtime.json opts out (null check).
 */
import { describe, test, it, expect, mock } from 'bun:test';
import { tmpdir } from 'os';

// resolveRuntimeConfig consults Prisma (task theme → theme by workdir) before
// falling back to rapitas.runtime.json; the real client hung the "no config"
// case for the full 5s timeout. Stub both lookups as "nothing configured".
mock.module('../../../../config/database', () => ({
  prisma: {
    task: { findUnique: () => Promise.resolve(null) },
    theme: { findFirst: () => Promise.resolve(null) },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { parseRuntimeConfig, substitutePort } = await import('./runtime-config');
const { evaluateSmokeFindings, looksLikeEnvironmentFailure, runRuntimeSmokeCheck } =
  await import('./runtime-check');

describe('looksLikeEnvironmentFailure', () => {
  it('matches worktree/tooling environment signatures', () => {
    expect(
      looksLikeEnvironmentFailure([
        'Symlink [project]/rapitas-frontend/node_modules is invalid, it points out of the filesystem root',
      ]),
    ).toBe(true);
    expect(looksLikeEnvironmentFailure(['Error [TurbopackInternalError]: boom'])).toBe(true);
    expect(looksLikeEnvironmentFailure(["Cannot find module 'C:/x/node_modules/next'"])).toBe(true);
    expect(looksLikeEnvironmentFailure(['sh: vite: command not found'])).toBe(true);
  });

  it('does not match ordinary app failures (those stay hard failures)', () => {
    expect(looksLikeEnvironmentFailure(['TypeError: x is not a function'])).toBe(false);
    expect(looksLikeEnvironmentFailure(['Error: listen EADDRINUSE :3000'])).toBe(false);
    expect(looksLikeEnvironmentFailure([])).toBe(false);
  });
});
import { allocateFreePort } from './app-launcher';
import type { PathFinding } from './browser-smoke';

function finding(overrides: Partial<PathFinding> = {}): PathFinding {
  return {
    path: '/',
    httpStatus: 200,
    navigationError: null,
    pageErrors: [],
    consoleErrors: [],
    serverErrors: [],
    screenshotPath: null,
    ...overrides,
  };
}

describe('parseRuntimeConfig', () => {
  test('accepts a minimal valid config and applies defaults', () => {
    const { config, error } = parseRuntimeConfig(
      JSON.stringify({ start: 'npm run dev -- -p {port}', url: 'http://127.0.0.1:{port}' }),
    );
    expect(error).toBeUndefined();
    expect(config!.healthPath).toBe('/');
    expect(config!.readyTimeoutMs).toBe(90_000);
    expect(config!.checkPaths).toEqual(['/']);
  });

  test('rejects missing start / non-http url / invalid JSON', () => {
    expect(parseRuntimeConfig('{}').error).toContain('start');
    expect(parseRuntimeConfig(JSON.stringify({ start: 'x', url: 'file:///etc' })).error).toContain(
      'url',
    );
    expect(parseRuntimeConfig('not json').error).toContain('JSON');
  });

  test('clamps readyTimeoutMs and filters non-path checkPaths', () => {
    const { config } = parseRuntimeConfig(
      JSON.stringify({
        start: 'x',
        url: 'http://127.0.0.1:{port}',
        readyTimeoutMs: 99_999_999,
        checkPaths: ['/ok', 'not-a-path', '/two'],
      }),
    );
    expect(config!.readyTimeoutMs).toBe(300_000);
    expect(config!.checkPaths).toEqual(['/ok', '/two']);
  });

  test('substitutePort replaces every {port} occurrence', () => {
    expect(substitutePort('next dev -p {port} --host http://x:{port}', 4123)).toBe(
      'next dev -p 4123 --host http://x:4123',
    );
  });
});

describe('evaluateSmokeFindings', () => {
  test('clean pages pass; console errors are advisory only', () => {
    const v = evaluateSmokeFindings({
      browserAvailable: true,
      findings: [finding({ consoleErrors: ['noisy dev warning'] })],
    });
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
    expect(v.lines.join('\n')).toContain('console.error');
  });

  test('page errors and 5xx responses fail the check', () => {
    const v = evaluateSmokeFindings({
      browserAvailable: true,
      findings: [
        finding({ pageErrors: ['TypeError: x is not a function'] }),
        finding({ path: '/admin', serverErrors: ['500 http://x/api'] }),
      ],
    });
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(2);
  });

  test('a navigation failure fails the check', () => {
    const v = evaluateSmokeFindings({
      browserAvailable: true,
      findings: [finding({ navigationError: 'net::ERR_CONNECTION_REFUSED' })],
    });
    expect(v.ok).toBe(false);
  });
});

describe('allocateFreePort', () => {
  test('returns a plausible free port', async () => {
    const port = await allocateFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe('runRuntimeSmokeCheck', () => {
  test('returns null for a project without rapitas.runtime.json', async () => {
    expect(await runRuntimeSmokeCheck(tmpdir())).toBeNull();
  });

  test('kill switch RAPITAS_RUNTIME_VERIFY=0 disables the stage', async () => {
    process.env.RAPITAS_RUNTIME_VERIFY = '0';
    try {
      expect(await runRuntimeSmokeCheck(tmpdir())).toBeNull();
    } finally {
      delete process.env.RAPITAS_RUNTIME_VERIFY;
    }
  });
});

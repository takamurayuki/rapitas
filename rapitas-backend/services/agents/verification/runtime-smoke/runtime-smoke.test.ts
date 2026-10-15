/**
 * runtime-smoke unit tests
 *
 * Verifies runtime-config parsing/validation, port substitution, the pure
 * smoke-verdict logic, free-port allocation, and that a project without
 * rapitas.runtime.json opts out (null check).
 */
import { describe, test, it, expect, mock } from 'bun:test';
import { tmpdir } from 'os';
import { mkdtempSync, writeFileSync } from 'fs';
import path from 'path';

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

// The crash-launch test must not spawn the real PowerShell process snapshot
// (Get-CimInstance, up to SNAPSHOT_TIMEOUT_MS=30s under suite load) nor write
// rt-check-* records into the production .agent-pids/runtime-servers.json.
// runRuntimeSmokeCheck has no injection point, so stub the two leaf modules.
// NOTE: mock.module is process-global — every real export is mirrored.
const realSnapshotModule = await import('./runtime-process-snapshot');
const realLauncherModule = await import('./app-launcher');
let launchedPid: number | undefined;
// NOTE: Bun's mock.module rewrites the live namespace, so the original
// function must be captured by reference first or the wrapper recurses.
const realLaunchApp = realLauncherModule.launchApp;
const realLauncherExports = { ...realLauncherModule };
mock.module('./app-launcher', () => ({
  ...realLauncherExports,
  launchApp: (...args: Parameters<typeof realLaunchApp>) => {
    const app = realLaunchApp(...args);
    launchedPid = app.pid;
    return app;
  },
}));
// Reports the really-launched child while it is alive, so the registry's
// identity check follows its intended path; everything else is an empty OS.
mock.module('./runtime-process-snapshot', () => ({
  ...realSnapshotModule,
  readRuntimeProcessSnapshot: async () => {
    let alive = false;
    if (launchedPid !== undefined) {
      try {
        process.kill(launchedPid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    return {
      processes: alive
        ? [{ pid: launchedPid!, parentPid: 1, birth: '1', command: 'node fail.js' }]
        : [],
      protectedPids: new Set<number>(),
      listeners: [],
    };
  },
}));
mock.module('./runtime-registry-store', () => ({
  RuntimeRegistryStore: class {
    private rows: unknown[] = [];
    async read() {
      return this.rows;
    }
    async update(change: (rows: unknown[]) => unknown[]) {
      this.rows = change(this.rows);
    }
  },
}));

const { parseRuntimeConfig, substitutePort } = await import('./runtime-config');
const {
  evaluateSmokeFindings,
  looksLikeEnvironmentFailure,
  normalizeLocalHost,
  runRuntimeSmokeCheck,
} = await import('./runtime-check');

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
import { allocateFreePort, computeTurbopackRootOverride, waitForHealthy } from './app-launcher';
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
        // `{port}` is mandatory now (launch contract): a start command without
        // it cannot be placed on the harness's port.
        start: 'x -p {port}',
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

describe('evaluateSmokeFindings — net::ERR_ABORTED is advisory', () => {
  const aborted = [
    'GET http://127.0.0.1:3000/__rapitas_api/schedules/reminders/pending',
    'GET http://127.0.0.1:3000/__rapitas_api/tasks/executing',
    'GET http://127.0.0.1:3000/__rapitas_api/events/status',
  ].map((l) => `${l}: net::ERR_ABORTED`);
  const run = (over: Partial<PathFinding>) =>
    evaluateSmokeFindings({ browserAvailable: true, findings: [finding(over)] });

  test('aborted-only failed requests do not fail the check and stay visible as advisory', () => {
    const v = run({ failedRequests: aborted });
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
    const text = v.lines.join('\n');
    expect(text).toContain('net::ERR_ABORTED ×3');
    expect(text).toContain('参考情報、ブロックしません');
  });

  test('repeated evaluation of the same input is stable', () => {
    for (let i = 0; i < 3; i++) {
      const v = run({ failedRequests: aborted });
      expect(v.ok).toBe(true);
      expect(v.errorCount).toBe(0);
    }
  });

  test('aborted mixed with a connection refusal still fails', () => {
    const v = run({
      failedRequests: [...aborted, 'GET http://127.0.0.1:3000/api/x: net::ERR_CONNECTION_REFUSED'],
    });
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(1);
  });

  test('aborted mixed with a 5xx or a page error still fails', () => {
    expect(run({ failedRequests: aborted, serverErrors: ['500 http://x/api'] }).ok).toBe(false);
    expect(run({ failedRequests: aborted, pageErrors: ['TypeError: x'] }).ok).toBe(false);
  });

  test('only an exact trailing ": net::ERR_ABORTED" is treated as aborted', () => {
    const v = run({ failedRequests: ['GET http://x/api: net::ERR_ABORTED_XYZ'] });
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(1);
  });

  test('empty or undefined failedRequests emit no advisory line', () => {
    expect(run({ failedRequests: [] }).lines.join('\n')).not.toContain('ERR_ABORTED');
    expect(run({}).ok).toBe(true);
  });

  test('contract: the collector emits labels ending in ": net::ERR_ABORTED"', async () => {
    const { createPageEvents, recordRequestFailure, snapshotPageEvents } =
      await import('./smoke-page-events.mjs');
    const events = createPageEvents();
    recordRequestFailure(events, {
      label: 'GET http://127.0.0.1:3000/api/tasks/executing',
      errorText: 'net::ERR_ABORTED',
      wasPending: true,
    });
    const { failedRequests } = snapshotPageEvents(events);
    expect(failedRequests).toHaveLength(1);
    expect(failedRequests[0].endsWith(': net::ERR_ABORTED')).toBe(true);
    expect(run({ failedRequests }).ok).toBe(true);
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

  test('reports the captured exit code instead of spinning the full readyTimeout when the app crashes on launch', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rt-check-'));
    const failScript = path.join(dir, 'fail.js');
    // Matches ENV_FAILURE_RE so this exercises the unverifiable branch,
    // which is where the exit-code diagnostic is most valuable — an
    // implementer cannot fix a worktree environment failure, but they can
    // use the exit code to tell it apart from a genuinely hung health check.
    writeFileSync(
      failScript,
      "console.error('points out of the filesystem root'); process.exit(7);",
    );
    writeFileSync(
      path.join(dir, 'rapitas.runtime.json'),
      JSON.stringify({
        // The script ignores the argument; `{port}` is required by the contract.
        start: `node ${JSON.stringify(failScript)} {port}`,
        url: 'http://127.0.0.1:{port}',
        readyTimeoutMs: 20_000,
      }),
    );
    const start = Date.now();
    const result = await runRuntimeSmokeCheck(dir, 'diag-test');
    expect(result).not.toBeNull();
    expect(result!.ran).toBe(false);
    expect(result!.ok).toBe(false);
    expect(result!.unverifiable).toBe(true);
    expect(result!.details).toContain('exitCode=7');
    // The early-exit short-circuit must fire well before the 20s readyTimeout.
    expect(Date.now() - start).toBeLessThan(15_000);
  }, 20_000);
});

describe('normalizeLocalHost', () => {
  test('rewrites a localhost host to 127.0.0.1', () => {
    expect(normalizeLocalHost('http://localhost:5000/health')).toBe('http://127.0.0.1:5000/health');
  });

  test('leaves an already-IP or external host unchanged', () => {
    expect(normalizeLocalHost('http://127.0.0.1:5000/')).toBe('http://127.0.0.1:5000/');
    expect(normalizeLocalHost('https://example.com/x')).toBe('https://example.com/x');
  });

  test('returns the input unchanged when it is not a parseable URL', () => {
    expect(normalizeLocalHost('not a url')).toBe('not a url');
  });
});

describe('waitForHealthy shouldAbort short-circuit', () => {
  test('returns false immediately when shouldAbort is already true, without waiting the timeout', async () => {
    const start = Date.now();
    const result = await waitForHealthy('http://127.0.0.1:9/', 10_000, {}, () => true);
    expect(result).toBe(false);
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe('computeTurbopackRootOverride', () => {
  test('returns undefined when rapitas-frontend/node_modules does not exist', () => {
    expect(computeTurbopackRootOverride(tmpdir())).toBeUndefined();
  });
});

describe('featureEntries in runtime config', () => {
  const base = { start: 'npm run dev -- -p {port}', url: 'http://127.0.0.1:{port}' };

  test('undeclared config stays without featureEntries (existing behavior)', () => {
    const { config } = parseRuntimeConfig(JSON.stringify(base));
    expect(config!.featureEntries).toBeUndefined();
  });

  test('declared entries are parsed and invalid ones are rejected', () => {
    const ok = parseRuntimeConfig(
      JSON.stringify({ ...base, featureEntries: [{ id: 'f-01', file: 'src/A.tsx' }] }),
    );
    expect(ok.config!.featureEntries).toEqual([{ id: 'F-01', file: 'src/A.tsx' }]);
    const bad = parseRuntimeConfig(
      JSON.stringify({ ...base, featureEntries: [{ id: 'F-01', file: '../x' }] }),
    );
    expect(bad.error).toContain('featureEntries');
  });

  test('undeclared + clean smoke keeps ok and records 判定不能 in details', async () => {
    const { applyFeatureReachability } = await import('./feature-reachability');
    const smoke = evaluateSmokeFindings({ browserAvailable: true, findings: [finding()] });
    const v = await applyFeatureReachability(smoke, {}, tmpdir());
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
    expect(v.lines.join('\n')).toContain('判定不能');
  });

  test('unreachable feature on a real directory fails and is named', async () => {
    const { applyFeatureReachability } = await import('./feature-reachability');
    const dir = mkdtempSync(path.join(tmpdir(), 'reach-'));
    writeFileSync(path.join(dir, 'empty.tsx'), '');
    const smoke = evaluateSmokeFindings({ browserAvailable: true, findings: [finding()] });
    const v = await applyFeatureReachability(
      smoke,
      {
        featureEntries: [
          { id: 'F-09', file: 'empty.tsx' },
          { id: 'F-10', file: 'none.tsx' },
        ],
      },
      dir,
    );
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(2);
    expect(v.lines.join('\n')).toContain('F-09, F-10');
  });
});

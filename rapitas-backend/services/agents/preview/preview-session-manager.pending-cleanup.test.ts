/**
 * preview-session-manager.pending-cleanup.test
 *
 * Regression coverage for the orphaned-process bug: startPreview keeps
 * running to completion server-side even after the calling client gives up
 * (a timed-out/abandoned fetch does NOT cancel the in-flight request), and
 * previously nothing tracked the dev-server process or browser until the
 * ENTIRE chain succeeded — so a client that gave up left them running
 * forever, invisible to `sessions`/stopPreview. Confirmed live: three
 * abandoned `next dev` processes for the same task, all still running,
 * fighting over the same build cache.
 *
 * These tests exercise the `pending` map directly via a startPreview call
 * deliberately stalled at the health-check step (waitForHealthy mocked to
 * hang until the test resolves it), verifying stopPreview can reach in and
 * kill the launched app before the attempt ever reaches `sessions`.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import * as realFs from 'fs';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { task: { findUnique: () => Promise.resolve(null) } },
}));
mock.module('../agent-session-resolver', () => ({
  resolveLatestSessionWorktree: () =>
    Promise.resolve({ worktreePath: '/repo', branchName: 'feature/x' }),
}));
// mock.module is process-global in bun:test — spread the real module so any
// OTHER export a transitive import needs (e.g. agent-process-tracker's
// readFileSync, pulled in via preview-session-manager's killProcessTreeSafely
// import) stays intact, and only override what this file actually needs.
mock.module('fs', () => ({ ...realFs, existsSync: () => true }));
mock.module('../verification/runtime-smoke/runtime-config', () => ({
  resolveRuntimeConfig: () =>
    Promise.resolve({
      config: {
        start: 'npm run dev -- -p {port}',
        url: 'http://localhost:{port}',
        healthPath: '/',
        readyTimeoutMs: 5_000,
        checkPaths: ['/'],
      },
    }),
  substitutePort: (template: string, port: number) => template.split('{port}').join(String(port)),
}));

const mockStop = mock(() => {});
const mockApp = { pid: 4242, logs: () => [], stop: mockStop };
const mockLaunchApp = mock(() => mockApp);
const mockAllocateFreePort = mock(() => Promise.resolve(54321));

/** Controlled by each test — lets startPreview be paused mid-flight. */
let resolveHealthy: (v: boolean) => void = () => {};
let healthyPromise: Promise<boolean>;
const mockWaitForHealthy = mock(() => healthyPromise);

mock.module('../verification/runtime-smoke/app-launcher', () => ({
  allocateFreePort: mockAllocateFreePort,
  launchApp: mockLaunchApp,
  waitForHealthy: mockWaitForHealthy,
}));

const { startPreview, stopPreview } = await import('./preview-session-manager');

beforeEach(() => {
  mockStop.mockClear();
  mockLaunchApp.mockClear();
  healthyPromise = new Promise<boolean>((res) => {
    resolveHealthy = res;
  });
});

describe('stopPreview cancels an in-progress launch', () => {
  it('kills the dev-server process launched by a still-starting attempt', async () => {
    const startResult = startPreview(42); // hangs at waitForHealthy until resolved below

    // Let startPreview run far enough to have called launchApp and
    // registered it in `pending` (a microtask tick is enough — everything
    // before waitForHealthy is either synchronous or resolves immediately
    // against the mocks above).
    await new Promise((r) => setTimeout(r, 10));
    expect(mockLaunchApp).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();

    await stopPreview(42);
    expect(mockStop).toHaveBeenCalledTimes(1);

    // Let the stalled startPreview call finish so it doesn't dangle into
    // the next test — its own result no longer matters (app.stop() from
    // stopPreview doesn't make waitForHealthy resolve on its own; the mock
    // needs an explicit answer here).
    resolveHealthy(false);
    const result = await startResult;
    expect(result.ok).toBe(false);
  });

  it('is a no-op when nothing is pending or active for the task', async () => {
    await expect(stopPreview(999_999)).resolves.toBeUndefined();
    expect(mockStop).not.toHaveBeenCalled();
  });
});

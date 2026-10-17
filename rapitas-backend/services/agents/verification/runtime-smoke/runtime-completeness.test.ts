import { beforeEach, expect, mock, test } from 'bun:test';
let configured = true;
let readySelector: string | undefined = '[data-app-ready="true"]';
let healthy = true;
let logs: string[] = [];
let browserAvailable = true;
let harnessError = false;
/** Whether the task under verification is the `[UI]` task that owes an entry. */
let screenTask = false;
const stop = mock(() => {});
const launch = mock(async () =>
  healthy
    ? {
        ok: true,
        baseUrl: 'http://127.0.0.1:3009',
        port: 3009,
        lease: 'test-lease',
        logs: () => logs,
      }
    : { ok: false, reason: 'startup failed', logs, hasExited: false, exitCode: null },
);
mock.module('./worktree-server-registry', () => ({
  acquireRuntimeServer: launch,
  releaseRuntimeServer: stop,
}));
mock.module('./runtime-config', () => ({
  resolveRuntimeConfig: async () =>
    configured
      ? {
          config: {
            start: 'app',
            url: 'http://127.0.0.1:3009',
            healthPath: '/',
            readyTimeoutMs: 100,
            checkPaths: ['/'],
            readySelector,
          },
        }
      : null,
  // Not under test here: no theme dir → the harness-drift check stays silent.
  resolveThemeWorkingDirectory: async () => null,
  // MUST be mirrored: bun's mock.module replaces the whole module, so an
  // export left out makes every import of it throw and the file stops
  // silently (measured here — six tests vanished with one unhandled error).
  taskRequiresFeatureEntries: async () => screenTask,
  substitutePort: (s: string) => s,
}));
mock.module('./browser-smoke', () => ({
  runBrowserSmoke: async () => {
    if (harnessError) throw new Error('harness');
    return {
      browserAvailable,
      unavailableReason: 'missing browser',
      findings: [
        { path: '/', httpStatus: 200, pageErrors: [], serverErrors: [], consoleErrors: [] },
      ],
    };
  },
}));
const { runRuntimeSmokeCheck } = await import('./runtime-check');
beforeEach(() => {
  configured = true;
  readySelector = '[data-app-ready="true"]';
  healthy = true;
  logs = [];
  browserAvailable = true;
  harnessError = false;
  screenTask = false;
  stop.mockClear();
  launch.mockClear();
});
// The config mocked above declares no featureEntries, which is the state every
// project is in until a screen task registers one. For an ordinary task that
// stays a note; for the screen task that owes the registration it is a failure.
test('a screen task that registered no featureEntries fails', async () => {
  screenTask = true;
  expect(await runRuntimeSmokeCheck('/screen-task', 'adhoc', 42)).toMatchObject({
    ran: true,
    ok: false,
  });
});
test('every other task keeps passing with no featureEntries', async () => {
  expect(await runRuntimeSmokeCheck('/feature-task', 'adhoc', 42)).toMatchObject({
    ran: true,
    ok: true,
  });
});
test('unconfigured projects remain not applicable', async () => {
  configured = false;
  expect(await runRuntimeSmokeCheck('/no-config')).toBeNull();
  expect(launch).not.toHaveBeenCalled();
});
test('completed browser verification succeeds and cleans up', async () => {
  expect(await runRuntimeSmokeCheck('/success')).toMatchObject({ ran: true, ok: true });
  expect(stop).toHaveBeenCalledTimes(1);
});
test('HTTP and browser checks without an application readiness contract remain unverified', async () => {
  readySelector = undefined;
  expect(await runRuntimeSmokeCheck('/no-readiness')).toMatchObject({
    ran: true,
    ok: false,
    unverifiable: true,
  });
  expect(stop).toHaveBeenCalledTimes(1);
});
test('app startup failure remains a failed executed check', async () => {
  healthy = false;
  expect(await runRuntimeSmokeCheck('/app-failure')).toMatchObject({
    ran: true,
    ok: false,
    errorCount: 1,
  });
});
test('environment failure and its cached result are both unverifiable', async () => {
  healthy = false;
  logs = ['points out of the filesystem root'];
  for (let i = 0; i < 2; i++) {
    expect(await runRuntimeSmokeCheck('/broken-env')).toMatchObject({
      ran: false,
      ok: false,
      unverifiable: true,
    });
  }
  expect(launch).toHaveBeenCalledTimes(1);
  // A failed acquisition provides no lease; registry failure cleanup is tested separately.
  expect(stop).not.toHaveBeenCalled();
});
test('HTTP readiness without browser cannot complete runtime verification', async () => {
  browserAvailable = false;
  expect(await runRuntimeSmokeCheck('/missing-browser')).toMatchObject({
    ran: false,
    ok: false,
    unverifiable: true,
  });
  expect(stop).toHaveBeenCalledTimes(1);
});
test('harness error retains unavailable evidence and cleans up', async () => {
  harnessError = true;
  expect(await runRuntimeSmokeCheck('/harness-error')).toMatchObject({
    ran: false,
    ok: false,
    unverifiable: true,
  });
  expect(stop).toHaveBeenCalledTimes(1);
});

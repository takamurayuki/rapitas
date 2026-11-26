/**
 * dev-restart-on-dry.rate-limit.test
 *
 * Pins the shared restart floor on path A (dev-restart-on-dry): with every
 * other gate passing, a restart is refused while EITHER persisted stamp
 * (.dev-restart-last-at or the merged-code paths' .auto-restart-merged-code-last-at)
 * is younger than the 60-minute default, and fires once both are older.
 * The stamps live in a temp RAPITAS_DATA_DIR because the floor must survive
 * the relaunch it throttles (task 1548).
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const originalDataDir = process.env.RAPITAS_DATA_DIR;
const originalTauri = process.env.TAURI_BUILD;
const originalInterval = process.env.RAPITAS_DEV_RESTART_MIN_INTERVAL_MS;
const tempDir = mkdtempSync(join(tmpdir(), 'dev-restart-rate-'));
process.env.RAPITAS_DATA_DIR = tempDir;
process.env.TAURI_BUILD = 'true';
delete process.env.RAPITAS_DEV_RESTART_MIN_INTERVAL_MS;

let head = 'startup-commit';
// promisify(execFile) honours util.promisify.custom, so headCommit() gets { stdout }.
const execFileMock = Object.assign((..._args: unknown[]) => {}, {
  [promisify.custom]: async () => ({ stdout: `${head}\n`, stderr: '' }),
});
mock.module('child_process', () => ({ execFile: execFileMock }));
mock.module('node:child_process', () => ({ execFile: execFileMock }));

const fastForwardPrimary = mock(async () => ({
  moved: false,
  reason: 'up-to-date',
  branch: 'develop',
}));
// Every non-type export: mock.module replaces the whole module.
mock.module('./primary-fast-forward', () => ({
  fastForwardPrimary,
  REGENERABLE_PATHS: [],
  parseDirtyPaths: () => [],
  onlyRegenerable: () => false,
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({ getActiveExecutionCount: () => 0, gracefulShutdown: async () => {} }),
  },
}));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    agentExecution: { count: async () => 0 },
    workflowQueueItem: { count: async () => 0 },
    themeAutoRun: { count: async () => 1 },
    userSettings: { findFirst: async () => ({ restartOnAutoRunDry: true, id: 1 }) },
  },
}));
mock.module('../../observability', () => ({ logCycleEvent: () => {} }));
mock.module('../workflow-runner', () => ({
  WorkflowRunner: { getInstance: () => ({ stopProcessing: async () => {} }) },
}));
mock.module('../../communication/realtime-service', () => ({
  RealtimeService: class {},
  realtimeService: { shutdown: () => {} },
}));
mock.module('../../communication/notify-once-per-window', () => ({
  DEFAULT_RENOTIFY_WINDOW_MS: 0,
  notifyOncePerWindow: async () => false,
}));
mock.module('../../agents/verification/runtime-smoke/runtime-server-shutdown', () => ({
  RUNTIME_SERVER_SHUTDOWN_TIMEOUT_MS: 0,
  stopAllRuntimeServersForShutdown: async () => ({ stopped: 0 }),
}));

const originalExit = process.exit;
// @ts-expect-error: replacing process.exit so a fired restart cannot end the runner
process.exit = mock((_code?: number) => {});

const { maybeRestartForUpdate, recordStartupCommit } = await import('./dev-restart-on-dry');
await recordStartupCommit();
head = 'merged-commit';

const MERGED_STAMP = join(tempDir, '.auto-restart-merged-code-last-at');
const DEV_STAMP = join(tempDir, '.dev-restart-last-at');
const minutesAgo = (m: number): string => String(Date.now() - m * 60_000);

beforeEach(() => {
  fastForwardPrimary.mockClear();
  rmSync(MERGED_STAMP, { force: true });
  rmSync(DEV_STAMP, { force: true });
});

afterAll(() => {
  process.exit = originalExit;
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
  if (originalTauri === undefined) delete process.env.TAURI_BUILD;
  else process.env.TAURI_BUILD = originalTauri;
  if (originalInterval !== undefined)
    process.env.RAPITAS_DEV_RESTART_MIN_INTERVAL_MS = originalInterval;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('maybeRestartForUpdate — shared 60-minute floor', () => {
  test('a merged-code restart 30 min ago holds path A (no fetch, no restart)', async () => {
    writeFileSync(MERGED_STAMP, minutesAgo(30));
    expect(await maybeRestartForUpdate(1)).toBe(false);
    expect(fastForwardPrimary).not.toHaveBeenCalled();
  });

  test('its own restart 30 min ago also holds path A (default was 10 min)', async () => {
    writeFileSync(DEV_STAMP, minutesAgo(30));
    expect(await maybeRestartForUpdate(1)).toBe(false);
    expect(fastForwardPrimary).not.toHaveBeenCalled();
  });

  test('both stamps older than 60 min: restarts and writes its own stamp', async () => {
    // Last test on purpose: a fired restart leaves the module's `restarting` flag set.
    writeFileSync(MERGED_STAMP, minutesAgo(61));
    writeFileSync(DEV_STAMP, minutesAgo(90));
    const before = Date.now();
    expect(await maybeRestartForUpdate(1)).toBe(true);
    expect(fastForwardPrimary).toHaveBeenCalledTimes(1);
    expect(Number(readFileSync(DEV_STAMP, 'utf8'))).toBeGreaterThanOrEqual(before);
  });
});

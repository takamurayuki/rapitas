/**
 * app-launcher.env.test
 *
 * 2026-11-22 (trendline task 1520): the app under test was spawned with the
 * backend's whole environment, so trendline's worker received rapitas's own
 * DATABASE_URL (file:...rapitas-dev.db), failed to parse it and exited, and the
 * runtime gate failed. The same env also carried rapitas's ENCRYPTION_KEY and
 * GitHub token into every project's app. Agent CLIs already start from
 * buildSanitizedSpawnEnv; the launcher must too.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as realChildProcess from 'child_process';

class FakeProc extends EventEmitter {
  pid = 4321;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

let lastEnv: NodeJS.ProcessEnv | undefined;
// The app is now started through spawnLowPriorityUntracked, which calls
// spawn(file, args, options) (or nice-wrapped on POSIX): options is the LAST argument.
const spawnMock = mock((_command: string, ...rest: unknown[]) => {
  lastEnv = (rest[rest.length - 1] as { env?: NodeJS.ProcessEnv } | undefined)?.env;
  return new FakeProc() as unknown as realChildProcess.ChildProcess;
});
mock.module('child_process', () => ({ ...realChildProcess, spawn: spawnMock }));
mock.module('../../agent-process-tracker', () => ({
  killProcessTreeSafely: mock(() => true),
  captureDescendants: mock(() => new Set<number>()),
  registerProcess: mock(() => {}),
  unregisterProcess: mock(() => {}),
  countLiveTrackedProcesses: mock(() => 0),
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getBackendLogFilePath: mock(() => '/fake/backend.log'),
}));

const { launchApp } = await import('./app-launcher');

const saved: Record<string, string | undefined> = {};
const KEYS = ['DATABASE_URL', 'ENCRYPTION_KEY', 'GITHUB_TOKEN', 'PATH'];

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.DATABASE_URL = 'file:C:/rapitas/.data/rapitas-dev.db';
  process.env.ENCRYPTION_KEY = 'rapitas-encryption-key-for-test';
  process.env.GITHUB_TOKEN = 'gh-token-for-test';
  lastEnv = undefined;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('launchApp environment', () => {
  test("never hands rapitas's database URL or secrets to the app under test", () => {
    launchApp('node scripts/dev-all.mjs 3100', 'C:/proj/.worktrees/task-1', 3100);
    expect(lastEnv).toBeDefined();
    expect(lastEnv?.DATABASE_URL).toBeUndefined();
    expect(lastEnv?.ENCRYPTION_KEY).toBeUndefined();
    expect(lastEnv?.GITHUB_TOKEN).toBeUndefined();
  });

  test('still passes the port and the ordinary environment', () => {
    launchApp('node scripts/dev-all.mjs 3100', 'C:/proj/.worktrees/task-1', 3100);
    expect(lastEnv?.PORT).toBe('3100');
    expect(lastEnv?.CI).toBe('1');
    expect(lastEnv?.PATH).toBe(process.env.PATH);
  });
});

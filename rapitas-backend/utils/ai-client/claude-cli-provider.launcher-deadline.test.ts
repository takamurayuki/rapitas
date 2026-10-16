/**
 * claude-cli-provider.launcher-deadline.test
 *
 * The OS launcher's deadline must follow the per-call timeout.
 *
 * Reported 2026-10-12: document generation requests `timeoutMs: 600000`, which
 * `resolveCliTimeoutMs` honours and this process's own timer respects — but the
 * launcher (windows-aux-job.ps1 / linux-aux-launcher.ts) only ever read the
 * backend's own `RAPITAS_AUX_AI_CLI_TIMEOUT_MS`, so it killed the CLI at the
 * 120s default and the caller saw
 * `Claude CLI exited 124: Auxiliary CLI launcher deadline exceeded`.
 *
 * `child_process` and the launcher are mocked — no real process is spawned.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';

// Small default so a LONGER per-call request is honoured (resolveCliTimeoutMs
// only ever raises). Baked in at import time.
process.env.RAPITAS_AUX_AI_CLI_TIMEOUT_MS = '1000';

type MutableStream = EventEmitter & { setEncoding: (enc: string) => void };

function makeStream(): MutableStream {
  const em = new EventEmitter() as MutableStream;
  em.setEncoding = () => {};
  return em;
}

class MockChild extends EventEmitter {
  pid = 5151;
  stdout = makeStream();
  stderr = makeStream();
  stdin = Object.assign(new EventEmitter(), { end: mock((_buf?: Buffer) => {}) });
  kill = mock(() => {});
}

let spawnedChildren: MockChild[] = [];
const mockSpawn = mock((_command: string, _args: string[], _options: Record<string, unknown>) => {
  const child = new MockChild();
  spawnedChildren.push(child);
  return child as unknown as ChildProcess;
});

/** Launcher deadlines seen, in call order. */
let launcherTimeouts: (number | undefined)[] = [];

// NOTE: every export of the real module is mirrored — a missing export makes the
// importing file stop silently under bun's process-global mock.module.
mock.module('./aux-cli-launch', () => ({
  LAUNCHER_TIMEOUT_ENV: 'RAPITAS_AUX_AI_CLI_TIMEOUT_MS',
  launcherEnv: (env: NodeJS.ProcessEnv) => env,
  prepareAuxCli: async (
    _command: string,
    _directory: string,
    _env: NodeJS.ProcessEnv,
    _args?: string[],
    timeoutMs?: number,
  ) => {
    launcherTimeouts.push(timeoutMs);
    return null;
  },
}));

mock.module('child_process', () => ({
  spawn: mockSpawn,
  execFileSync: mock(() => Buffer.from('')),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => {}),
}));

mock.module('../common/cli-path-resolver', () => ({
  getClaudePathAsync: mock(() => Promise.resolve('claude.cmd')),
}));

mock.module('./aux-cli-cleanup', () => ({
  auxCliCleanup: {
    assertReady: () => {},
    stop: (child: MockChild) => {
      child.kill();
      return true;
    },
  },
}));

mock.module('../../services/agents/agent-process-tracker', () => ({
  registerProcess: mock(() => {}),
  unregisterProcess: mock(() => {}),
  countLiveTrackedProcesses: mock(() => 0),
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  },
  getBackendLogFilePath: mock((_stamp?: string) => 'mock-log-path'),
}));

const { callClaudeCli } = await import('./claude-cli-provider');
const { DEFAULT_CLI_TIMEOUT_MS, LAUNCHER_GRACE_MS } = await import('./claude-cli-timeouts');

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const messages = [{ role: 'user' as const, content: 'hello' }];

/** Drive one call to completion and return the launcher deadline it requested. */
async function deadlineFor(timeoutMs?: number): Promise<number | undefined> {
  const promise = callClaudeCli(undefined, messages, undefined, 1024, timeoutMs);
  await flush();
  const child = spawnedChildren[0];
  child.stdout.emit('data', '{"result":"ok","usage":{"input_tokens":1,"output_tokens":1}}');
  child.emit('close', 0);
  await promise;
  return launcherTimeouts[0];
}

beforeEach(() => {
  spawnedChildren = [];
  launcherTimeouts = [];
  mockSpawn.mockClear();
});

describe('launcher deadline follows the per-call timeout', () => {
  test('a longer per-call timeout reaches the launcher', async () => {
    expect(await deadlineFor(600_000)).toBe(600_000 + LAUNCHER_GRACE_MS);
  });

  test('without a per-call timeout the launcher gets the default', async () => {
    expect(await deadlineFor()).toBe(DEFAULT_CLI_TIMEOUT_MS + LAUNCHER_GRACE_MS);
  });

  test('the launcher deadline exceeds the provider timer, so the timer wins', async () => {
    const deadline = await deadlineFor(600_000);
    expect(deadline).toBeGreaterThan(600_000);
  });
});

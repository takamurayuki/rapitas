/**
 * claude-cli-provider.prompt-guard.test
 *
 * Verifies that BOTH CLI entry points (callClaudeCli and callClaudeCliStream) run the
 * prompt size guard before handing the prompt to the spawned `claude --print` process.
 * `child_process` is mocked; no real CLI is spawned. Kept apart from
 * claude-cli-provider.test.ts to stay under the file-size policy.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';

type MutableStream = EventEmitter & { setEncoding: (enc: string) => void };

function makeStream(): MutableStream {
  const em = new EventEmitter() as MutableStream;
  em.setEncoding = () => {};
  return em;
}

class MockChild extends EventEmitter {
  stdout = makeStream();
  stderr = makeStream();
  stdin = Object.assign(new EventEmitter(), { end: mock((_buf?: Buffer) => {}) });
  kill = mock(() => {});
}

let spawnedChildren: MockChild[] = [];

mock.module('./aux-cli-launch', () => ({ prepareAuxCli: async () => null }));
mock.module('child_process', () => ({
  spawn: mock(() => {
    const child = new MockChild();
    spawnedChildren.push(child);
    return child as unknown as ChildProcess;
  }),
  execSync: mock(() => ''),
  execFile: mock(() => {
    throw new Error('Unexpected process snapshot in provider unit test');
  }),
  execFileSync: mock(() => Buffer.from('')),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => {}),
}));
mock.module('../common/cli-path-resolver', () => ({
  getClaudePathAsync: mock(() => Promise.resolve('claude.cmd')),
}));
mock.module('../../config/logger', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { logger: l, createLogger: () => l, getBackendLogFilePath: () => 'mock-log-path' };
});

const { callClaudeCli, callClaudeCliStream } = await import('./claude-cli-provider');

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function stdinText(child: MockChild): string {
  return ((child.stdin.end as ReturnType<typeof mock>).mock.calls[0][0] as Buffer).toString('utf8');
}

const ENV_KEY = 'RAPITAS_AUX_AI_MAX_PROMPT_TOKENS';

beforeEach(() => {
  spawnedChildren = [];
  process.env[ENV_KEY] = '50'; // 100 chars
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('claude-cli-provider prompt size guard', () => {
  test('callClaudeCli truncates an oversized prompt before it reaches stdin', async () => {
    const promise = callClaudeCli(
      undefined,
      [{ role: 'user', content: 'HEAD' + 'x'.repeat(5_000) }],
      undefined,
      100,
    );
    await flush();
    const text = stdinText(spawnedChildren[0]);
    expect(text.length).toBe(100);
    expect(text.startsWith('HEAD')).toBe(true);
    spawnedChildren[0].stdout.emit('data', JSON.stringify({ result: 'ok', is_error: false }));
    spawnedChildren[0].emit('close', 0);
    await promise;
  });

  test('callClaudeCliStream truncates an oversized prompt before it reaches stdin', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'HEAD' + 'x'.repeat(5_000) }],
      undefined,
      100,
    );
    await flush();
    const text = stdinText(spawnedChildren[0]);
    expect(text.length).toBe(100);
    expect(text.startsWith('HEAD')).toBe(true);
    spawnedChildren[0].emit('close', 0);
    await stream.cancel().catch(() => {});
  });

  test('callClaudeCli leaves a small prompt untouched', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'short' }], undefined, 100);
    await flush();
    expect(stdinText(spawnedChildren[0])).toBe('short');
    spawnedChildren[0].stdout.emit('data', JSON.stringify({ result: 'ok', is_error: false }));
    spawnedChildren[0].emit('close', 0);
    await promise;
  });
});

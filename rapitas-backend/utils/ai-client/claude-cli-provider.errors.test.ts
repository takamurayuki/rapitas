/**
 * claude-cli-provider.errors.test
 *
 * Error-classification coverage for the Claude Code CLI provider: spawn
 * failures, non-zero exits, wall-clock timeouts, and malformed CLI output —
 * for both the one-shot (callClaudeCli) and streaming (callClaudeCliStream)
 * entry points. Happy-path / concurrency coverage lives in
 * claude-cli-provider.test.ts; pure-parsing/platform-branch coverage lives in
 * claude-cli-provider.parsing.test.ts.
 *
 * `child_process` is mocked end-to-end — no real `claude` CLI process is ever
 * spawned.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';

// A short wall-clock cap keeps the timeout tests fast; read once at module
// load (this constant is baked into the SUT at import time).
process.env.RAPITAS_AUX_AI_CLI_TIMEOUT_MS = '150';

// ── child_process mock (see claude-cli-provider.test.ts for rationale) ─────

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
let execSyncImpl: (cmd: string) => string = () => {
  throw new Error('not found');
};

const mockSpawn = mock((_command: string, _args: string[], _options: Record<string, unknown>) => {
  const child = new MockChild();
  spawnedChildren.push(child);
  return child as unknown as ChildProcess;
});
const mockExecSync = mock((cmd: string) => execSyncImpl(cmd));

mock.module('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
  exec: mock(() => {}),
  execFile: mock(() => {}),
  execFileSync: mock(() => Buffer.from('')),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => {}),
}));

mock.module('../../config/logger', () => ({
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  },
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
  getBackendLogFilePath: mock((_stamp?: string) => 'mock-log-path'),
}));

const { callClaudeCli, callClaudeCliStream, ClaudeCliUnavailableError } =
  await import('./claude-cli-provider');

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function drainSSE(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

beforeEach(() => {
  spawnedChildren = [];
  execSyncImpl = () => {
    throw new Error('not found');
  };
  mockSpawn.mockClear();
});

// ── callClaudeCli: process-level failures ────────────────────────────────────

describe('callClaudeCli — process failures', () => {
  test('spawn error event rejects with ClaudeCliUnavailableError', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    spawnedChildren[0].emit('error', new Error('ENOENT: no such file'));
    await expect(promise).rejects.toThrow(ClaudeCliUnavailableError);
    await expect(promise).rejects.toThrow(/Claude CLI spawn failed: ENOENT/);
  });

  test('non-zero exit with stderr surfaces a truncated stderr message', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    const longStderr = 'x'.repeat(350);
    spawnedChildren[0].stderr.emit('data', longStderr);
    spawnedChildren[0].emit('close', 1);
    await expect(promise).rejects.toThrow(ClaudeCliUnavailableError);
    try {
      await promise;
      throw new Error('expected rejection');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Claude CLI exited 1');
      expect(message).toContain(longStderr.slice(0, 300));
      expect(message).not.toContain(longStderr.slice(0, 301));
    }
  });

  test('non-zero exit with empty stderr falls back to stdout in the error message', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    spawnedChildren[0].stdout.emit('data', 'partial stdout output');
    spawnedChildren[0].emit('close', 2);
    await expect(promise).rejects.toThrow(/partial stdout output/);
  });

  test('a stuck CLI times out, kills the child, and rejects', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    await expect(promise).rejects.toThrow(/Claude CLI timed out after 150ms/);
    expect(spawnedChildren[0].kill).toHaveBeenCalled();
  });

  test('a stdin write error is logged but does not fail an otherwise-successful call', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    const child = spawnedChildren[0];
    child.stdin.emit('error', new Error('EPIPE'));
    child.stdout.emit('data', JSON.stringify({ result: 'still ok', is_error: false, usage: {} }));
    child.emit('close', 0);
    const response = await promise;
    expect(response.content).toBe('still ok');
  });
});

// ── callClaudeCli: malformed CLI output ──────────────────────────────────────

describe('callClaudeCli — malformed output', () => {
  test('unparseable stdout (no JSON at all) rejects', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    spawnedChildren[0].stdout.emit('data', 'plain text, not json at all');
    spawnedChildren[0].emit('close', 0);
    await expect(promise).rejects.toThrow(/Claude CLI returned unparseable output/);
  });

  test('is_error:true in the parsed payload rejects', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    spawnedChildren[0].stdout.emit('data', JSON.stringify({ result: 'x', is_error: true }));
    spawnedChildren[0].emit('close', 0);
    await expect(promise).rejects.toThrow(/Claude CLI reported an error/);
  });

  test('subtype:"error" in the parsed payload rejects even when is_error is falsy', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    spawnedChildren[0].stdout.emit(
      'data',
      JSON.stringify({ result: 'x', is_error: false, subtype: 'error' }),
    );
    spawnedChildren[0].emit('close', 0);
    await expect(promise).rejects.toThrow(/Claude CLI reported an error/);
  });

  test('a missing/non-string result field rejects', async () => {
    const promise = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    spawnedChildren[0].stdout.emit('data', JSON.stringify({ is_error: false }));
    spawnedChildren[0].emit('close', 0);
    await expect(promise).rejects.toThrow(/Claude CLI reported an error/);
  });
});

// ── callClaudeCliStream: process-level failures ──────────────────────────────

describe('callClaudeCliStream — process failures', () => {
  test('spawn error event yields a single error frame with no [DONE]', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    child.emit('error', new Error('spawn ENOENT'));
    const raw = await readPromise;
    expect(raw).toContain('"error":"Claude CLI spawn failed: spawn ENOENT"');
    expect(raw).not.toContain('[DONE]');
  });

  test('non-zero exit yields an error frame with the exit code and stderr', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    child.stderr.emit('data', 'boom');
    child.emit('close', 7);
    const raw = await readPromise;
    expect(raw).toContain('Claude CLI exited 7: boom');
    expect(raw).not.toContain('[DONE]');
  });

  test('a stuck streaming CLI times out, kills the child, and emits an error frame', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    const raw = await readPromise;
    expect(raw).toContain('Claude CLI timed out after 150ms');
    expect(child.kill).toHaveBeenCalled();
  });
});

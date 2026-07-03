/**
 * claude-cli-provider.parsing.test
 *
 * Coverage for the pure/internal plumbing of the Claude Code CLI provider
 * that isn't exported directly: CLI path resolution + caching
 * (resolveCliPath/getClaudePath), the Windows spawn-command builder
 * (buildSpawnCommand), the spawn env builder (buildCliEnv), non-Windows
 * platform branches, `extractLastJsonObject`, and the streaming NDJSON line
 * buffer (handleLine). These are exercised indirectly through the public
 * callClaudeCli/callClaudeCliStream entry points by inspecting what gets
 * passed to the mocked `spawn`/`execSync`.
 *
 * Happy-path / concurrency coverage lives in claude-cli-provider.test.ts;
 * error-classification coverage lives in claude-cli-provider.errors.test.ts.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';

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

let spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
let spawnedChildren: MockChild[] = [];
let execSyncImpl: (cmd: string) => string = () => {
  throw new Error('not found');
};

const mockSpawn = mock((command: string, args: string[], options: Record<string, unknown>) => {
  spawnCalls.push({ command, args, options });
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

const { callClaudeCli, callClaudeCliStream } = await import('./claude-cli-provider');

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function respondSuccess(child: MockChild, result = 'ok'): void {
  child.stdout.emit(
    'data',
    JSON.stringify({ result, is_error: false, usage: { input_tokens: 1, output_tokens: 1 } }),
  );
  child.emit('close', 0);
}

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

/** Temporarily overrides process.platform for the duration of `fn`. */
async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

beforeEach(() => {
  spawnCalls = [];
  spawnedChildren = [];
  execSyncImpl = () => {
    throw new Error('not found');
  };
  mockSpawn.mockClear();
  mockExecSync.mockClear();
});

afterEach(() => {
  delete process.env.CLAUDE_CODE_PATH;
});

// ── resolveCliPath / getClaudePath (Windows — the real platform under test) ──

describe('resolveCliPath / getClaudePath — Windows', () => {
  test('resolves via `where` and caches the result across subsequent calls', async () => {
    process.env.CLAUDE_CODE_PATH = 'rc-exists-test';
    execSyncImpl = (cmd) => {
      if (cmd === 'where rc-exists-test') return `${process.execPath}\n`;
      throw new Error('unexpected command: ' + cmd);
    };

    const p1 = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[0]);
    await p1;
    expect(spawnCalls[0].command).toContain(
      spawnCalls[0].command.includes(' ') && process.execPath.includes(' ')
        ? `"${process.execPath}"`
        : process.execPath,
    );
    expect(mockExecSync).toHaveBeenCalledTimes(1);

    const p2 = callClaudeCli(undefined, [{ role: 'user', content: 'hi again' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[1]);
    await p2;
    expect(mockExecSync).toHaveBeenCalledTimes(1); // cached — no second `where`
  });

  test('falls back to the raw command when `where` fails for both the bare name and .cmd variant', async () => {
    process.env.CLAUDE_CODE_PATH = 'rc-notfound-test';
    execSyncImpl = () => {
      throw new Error('not found');
    };

    const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[0]);
    await p;

    expect(spawnCalls[0].command).toContain('rc-notfound-test');
    expect(mockExecSync).toHaveBeenCalledTimes(2); // bare name + .cmd variant
  });

  test('tries the .cmd-suffixed variant when the bare name lookup fails', async () => {
    process.env.CLAUDE_CODE_PATH = 'rc-cmdfallback-test';
    execSyncImpl = (cmd) => {
      if (cmd === 'where rc-cmdfallback-test.cmd') return `${process.execPath}\n`;
      throw new Error('not found');
    };

    const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[0]);
    await p;

    expect(spawnCalls[0].command).toContain(process.execPath);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  test('does not attempt a .cmd fallback when the base name already ends in .cmd', async () => {
    process.env.CLAUDE_CODE_PATH = 'rc-alreadycmd-test.cmd';
    execSyncImpl = () => {
      throw new Error('not found');
    };

    const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[0]);
    await p;

    expect(spawnCalls[0].command).toContain('rc-alreadycmd-test.cmd');
    expect(mockExecSync).toHaveBeenCalledTimes(1); // no second attempt
  });

  test('treats a `where` result that points at a nonexistent file as not-found', async () => {
    process.env.CLAUDE_CODE_PATH = 'rc-noexist-test';
    execSyncImpl = () => 'Z:\\definitely\\not\\a\\real\\path\\claude123.exe\n';

    const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[0]);
    await p;

    expect(spawnCalls[0].command).toContain('rc-noexist-test');
    expect(spawnCalls[0].command).not.toContain('claude123.exe');
  });

  test('quotes a raw path containing spaces when building the spawn command', async () => {
    process.env.CLAUDE_CODE_PATH = 'C:\\Program Files\\Claude\\claude.cmd';
    execSyncImpl = () => {
      throw new Error('not found');
    };

    const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[0]);
    await p;

    expect(spawnCalls[0].command).toContain('"C:\\Program Files\\Claude\\claude.cmd"');
  });
});

// ── buildCliEnv ───────────────────────────────────────────────────────────────

describe('buildCliEnv', () => {
  test('adds Windows UTF-8 env overrides on the real (win32) platform', async () => {
    const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    respondSuccess(spawnedChildren[0]);
    await p;
    const env = spawnCalls[0].options.env as NodeJS.ProcessEnv;
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.CHCP).toBe('65001');
    expect(env.NODE_OPTIONS).toBe('--no-warnings');
  });
});

// ── non-Windows platform branches ────────────────────────────────────────────

describe('non-Windows platform branches', () => {
  test('resolveCliPath skips `where` entirely; buildSpawnCommand keeps a real argv array', async () => {
    await withPlatform('darwin', async () => {
      const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
      await flush();
      respondSuccess(spawnedChildren[0]);
      await p;
    });

    expect(mockExecSync).not.toHaveBeenCalled();
    const call = spawnCalls[0];
    expect(call.command).toBe('claude'); // unsuffixed default binary name on non-Windows
    expect(call.args.length).toBeGreaterThan(0);
    expect(call.args).toContain('--model');
    const env = call.options.env as NodeJS.ProcessEnv;
    expect(env.LANG).toBeUndefined();
    expect(env.CHCP).toBeUndefined();
  });
});

// ── extractLastJsonObject (via callClaudeCli stdout parsing) ─────────────────

describe('extractLastJsonObject', () => {
  test('extracts the last balanced JSON object, ignoring earlier JSON-looking noise', async () => {
    const p = callClaudeCli(undefined, [{ role: 'user', content: 'hi' }], undefined, 100);
    await flush();
    const noise = 'Loading...\n{"unrelated":"blob","nested":{"x":1}}\nsome more CLI banner text\n';
    const finalPayload = {
      result: 'final answer',
      is_error: false,
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    spawnedChildren[0].stdout.emit('data', noise + JSON.stringify(finalPayload) + '\n\n');
    spawnedChildren[0].emit('close', 0);
    const response = await p;
    expect(response.content).toBe('final answer');
  });
});

// ── streaming: NDJSON line buffering (handleLine) ────────────────────────────

describe('callClaudeCliStream — line buffering', () => {
  test('reassembles a JSON line split across multiple stdout chunks', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'split-line-ok' }] },
    });
    child.stdout.emit('data', line.slice(0, 10));
    child.stdout.emit('data', line.slice(10) + '\n');
    child.emit('close', 0);
    const raw = await readPromise;
    expect(raw).toContain('split-line-ok');
  });

  test('processes multiple NDJSON lines delivered in a single chunk', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    const line1 = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'first' }] },
    });
    const line2 = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'second' }] },
    });
    child.stdout.emit('data', `${line1}\n${line2}\n`);
    child.emit('close', 0);
    const raw = await readPromise;
    expect(raw).toContain('first');
    expect(raw).toContain('second');
  });

  test('ignores non-JSON noise lines without crashing the stream', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    child.stdout.emit('data', 'not json at all\n');
    child.stdout.emit(
      'data',
      `${JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'valid-after-noise' }] },
      })}\n`,
    );
    child.emit('close', 0);
    const raw = await readPromise;
    expect(raw).toContain('valid-after-noise');
    expect(raw).not.toContain('"error"');
  });

  test('flushes a trailing line lacking a terminating newline when the process closes', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    // No trailing '\n' — relies on the close handler's flush of a leftover lineBuffer.
    child.stdout.emit(
      'data',
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'no-trailing-newline' }] },
      }),
    );
    child.emit('close', 0);
    const raw = await readPromise;
    expect(raw).toContain('no-trailing-newline');
  });

  test('ignores non-text content blocks (e.g. tool_use) within an assistant message', async () => {
    const stream = await callClaudeCliStream(
      undefined,
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    const readPromise = drainSSE(stream);
    child.stdout.emit(
      'data',
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', text: 'should-not-appear' },
            { type: 'text', text: 'only-this-text' },
          ],
        },
      })}\n`,
    );
    child.emit('close', 0);
    const raw = await readPromise;
    expect(raw).toContain('only-this-text');
    expect(raw).not.toContain('should-not-appear');
  });
});

// ── streaming: request shape ──────────────────────────────────────────────────

describe('callClaudeCliStream — request shape', () => {
  test('requests stream-json output, verbose mode, and the same tool restrictions', async () => {
    const stream = await callClaudeCliStream(
      'claude-3-5-sonnet-20241022',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const child = spawnedChildren[0];
    child.emit('close', 0);
    await drainSSE(stream);

    expect(spawnCalls[0].command).toContain('--verbose');
    expect(spawnCalls[0].command).toContain('--output-format stream-json');
    expect(spawnCalls[0].command).toContain('--model sonnet');
    expect(spawnCalls[0].command).toContain('--disallowedTools Bash,Edit,Write');
  });
});

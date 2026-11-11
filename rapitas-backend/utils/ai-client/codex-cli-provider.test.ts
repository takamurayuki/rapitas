/**
 * codex-cli-provider.test
 *
 * The auxiliary Codex CLI call: its argv (the routing2b §7-1 mitigations),
 * its environment (no API key, no secrets), the empty per-call directory,
 * reading the answer, failing with vendor 'openai', the timeout, and the
 * ChatGPT-login availability probe. `child_process` is mocked — no real CLI.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import type { ChildProcess } from 'child_process';

process.env.RAPITAS_AUX_AI_CODEX_TIMEOUT_MS = '150';

type MutableStream = EventEmitter & { setEncoding: (enc: string) => void };
const makeStream = (): MutableStream =>
  Object.assign(new EventEmitter(), { setEncoding: () => {} }) as MutableStream;

interface Script {
  stdout?: string;
  stderr?: string;
  code?: number;
  hang?: boolean;
}

class MockChild extends EventEmitter {
  pid = 5151;
  stdout = makeStream();
  stderr = makeStream();
  stdinText = '';
  kill = mock(() => {});
  stdin: EventEmitter & { end: (buf?: Buffer) => void };
  constructor(script: Script) {
    super();
    this.stdin = Object.assign(new EventEmitter(), {
      end: (buf?: Buffer) => {
        this.stdinText = buf ? buf.toString('utf8') : '';
        if (script.hang) return;
        setImmediate(() => {
          if (script.stdout) this.stdout.emit('data', script.stdout);
          if (script.stderr) this.stderr.emit('data', script.stderr);
          this.emit('close', script.code ?? 0);
        });
      },
    });
  }
}

let scripts: Script[] = [];
const spawned: Array<{ args: string[]; options: Record<string, unknown>; child: MockChild }> = [];
const cwdSeenAtSpawn: Array<{ exists: boolean; entries: number }> = [];

const mockSpawn = mock((_cmd: string, args: string[], options: Record<string, unknown>) => {
  const child = new MockChild(scripts.shift() ?? {});
  const cwd = String(options.cwd);
  cwdSeenAtSpawn.push({
    exists: existsSync(cwd),
    entries: existsSync(cwd) ? readdirSync(cwd).length : -1,
  });
  spawned.push({ args, options, child });
  return child as unknown as ChildProcess;
});

mock.module('./aux-cli-launch', () => ({
  prepareAuxCli: async () => null,
  launcherEnv: (env: NodeJS.ProcessEnv) => env,
  LAUNCHER_TIMEOUT_ENV: 'RAPITAS_AUX_AI_CLI_TIMEOUT_MS',
}));
mock.module('child_process', () => ({
  spawn: mockSpawn,
  execFileSync: mock(() => Buffer.from('')),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => {}),
}));
mock.module('../common/cli-path-resolver', () => ({
  resolveCliPathAsync: async (name: string) => name,
  getClaudePathAsync: async () => 'claude',
  __resetCliPathCacheForTests: () => {},
}));
const untrackCalls: number[] = [];
mock.module('./aux-cli-cleanup', () => ({
  auxCliCleanup: {
    assertReady: () => {},
    stop: (child: MockChild) => {
      child.kill();
      return true;
    },
  },
  createAuxCliCleanup: () => ({}),
  trackAuxCliChild: (child: { pid?: number }) => () => untrackCalls.push(child.pid ?? -1),
}));

const {
  buildCodexAuxArgs,
  buildCodexAuxEnv,
  callCodexCli,
  getCodexCliStatus,
  __resetCodexCliStatusForTests,
  CODEX_AUX_PREAMBLE,
} = await import('./codex-cli-provider');
const { CodexCliUnavailableError } = await import('./cli-errors');

const ok = (text: string) =>
  [
    JSON.stringify({ type: 'thread.started', thread_id: 't' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 },
    }),
  ].join('\n');

// Every call re-reads the login before `exec` (G2 finding 1), so each call
// script starts with this probe answer.
const LOGIN_OK: Script = { stdout: 'Logged in using ChatGPT' };

beforeEach(() => {
  scripts = [];
  spawned.length = 0;
  cwdSeenAtSpawn.length = 0;
  untrackCalls.length = 0;
  mockSpawn.mockClear();
  __resetCodexCliStatusForTests();
});
afterAll(() => {
  delete process.env.RAPITAS_AUX_AI_CODEX_TIMEOUT_MS;
});

describe('buildCodexAuxArgs', () => {
  test('carries every mitigation and reads the prompt from stdin', () => {
    const args = buildCodexAuxArgs('gpt-6-astra', '/tmp/x');
    expect(args.slice(0, 3)).toEqual(['--ask-for-approval', 'never', 'exec']);
    for (const flag of [
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
    ]) {
      expect(args).toContain(flag);
    }
    expect(args.join(' ')).toContain('--sandbox read-only');
    expect(args.join(' ')).toContain('-C /tmp/x');
    expect(args.join(' ')).toContain('-m gpt-6-astra');
    for (const f of ['shell_tool', 'unified_exec', 'browser_use', 'computer_use']) {
      expect(args).toContain(`features.${f}=false`);
    }
    // `--disable` aborts on a feature name the CLI version does not know.
    expect(args).not.toContain('--disable');
    expect(args[args.length - 1]).toBe('-');
  });

  test('no -m without a model; effort only when it is a bare word', () => {
    process.env.RAPITAS_AUX_AI_CODEX_EFFORT = 'low';
    expect(buildCodexAuxArgs(undefined, '/d')).not.toContain('-m');
    expect(buildCodexAuxArgs(undefined, '/d')).toContain('model_reasoning_effort="low"');
    process.env.RAPITAS_AUX_AI_CODEX_EFFORT = 'low" -c x="y';
    expect(buildCodexAuxArgs(undefined, '/d').join(' ')).not.toContain('model_reasoning_effort');
    delete process.env.RAPITAS_AUX_AI_CODEX_EFFORT;
  });
});

describe('buildCodexAuxEnv', () => {
  test('drops API keys and secrets, keeps the Codex login home', () => {
    const keys = {
      OPENAI_API_KEY: 'sk-test',
      CODEX_API_KEY: 'sk-codex',
      ANTHROPIC_API_KEY: 'sk-ant',
      DATABASE_URL: 'postgres://secret',
      CODEX_HOME: '/home/u/.codex',
    };
    const before = Object.fromEntries(Object.keys(keys).map((k) => [k, process.env[k]]));
    Object.assign(process.env, keys);
    let env: NodeJS.ProcessEnv;
    try {
      env = buildCodexAuxEnv();
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CODEX_HOME).toBe('/home/u/.codex');
    expect(env.CI).toBe('1');
  });
});

describe('callCodexCli', () => {
  test('answers from the last agent message, in an empty directory removed afterwards', async () => {
    scripts = [LOGIN_OK, { stdout: ok('{"verdict":"pass"}') }];
    const res = await callCodexCli(
      'gpt-6.1-sol',
      [{ role: 'user', content: 'DIFF' }],
      'Be skeptical.',
      2000,
    );
    expect(res).toMatchObject({
      content: '{"verdict":"pass"}',
      tokensUsed: 107,
      inputTokens: 60,
      cacheReadInputTokens: 40,
      outputTokens: 7,
      modelName: 'gpt-6.1-sol',
    });
    expect(res.costUsd).toBeUndefined();
    expect(spawned[0].args).toEqual(['login', 'status']);
    const { args, options, child } = spawned[1];
    expect(cwdSeenAtSpawn[1]).toEqual({ exists: true, entries: 0 });
    expect(args).toContain(String(options.cwd));
    expect(existsSync(String(options.cwd))).toBe(false);
    expect(child.stdinText.startsWith(CODEX_AUX_PREAMBLE)).toBe(true);
    expect(child.stdinText).toContain('Be skeptical.');
    expect(child.stdinText).toContain('DIFF');
    // Both the login probe and the exec child are tracked and untracked.
    expect(untrackCalls).toEqual([5151, 5151]);
  });

  test('a failed turn throws vendor openai with the CLI reason', async () => {
    scripts = [
      LOGIN_OK,
      {
        code: 1,
        stdout: JSON.stringify({
          type: 'turn.failed',
          error: { message: "You've hit your usage limit. Try again at 3:05 PM." },
        }),
      },
    ];
    const err = await callCodexCli(
      'gpt-6-astra',
      [{ role: 'user', content: 'x' }],
      undefined,
      1,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexCliUnavailableError);
    expect((err as InstanceType<typeof CodexCliUnavailableError>).vendor).toBe('openai');
    expect((err as Error).message).toContain('usage limit');
  });

  test('exit 0 without an answer is still a failure', async () => {
    scripts = [LOGIN_OK, { stdout: JSON.stringify({ type: 'turn.completed', usage: {} }) }];
    await expect(
      callCodexCli('gpt-6-astra', [{ role: 'user', content: 'x' }], undefined, 1),
    ).rejects.toThrow('returned no answer');
  });

  test('times out, stops the child and removes the directory', async () => {
    scripts = [LOGIN_OK, { hang: true }];
    await expect(
      callCodexCli('gpt-6-astra', [{ role: 'user', content: 'x' }], undefined, 1),
    ).rejects.toThrow('timed out after 150ms');
    expect(spawned[1].child.kill).toHaveBeenCalled();
    expect(existsSync(String(spawned[1].options.cwd))).toBe(false);
  });
});

describe('getCodexCliStatus', () => {
  test('ready only on a ChatGPT login', async () => {
    scripts = [{ stdout: 'codex-cli 0.167.0' }, { stdout: 'Logged in using ChatGPT' }];
    expect(await getCodexCliStatus()).toBe('ready');
    expect(spawned.map((s) => s.args.join(' '))).toEqual(['--version', 'login status']);
    // Memoised: no further spawn.
    expect(await getCodexCliStatus()).toBe('ready');
    expect(spawned).toHaveLength(2);
  });

  test('an API-key login is refused', async () => {
    scripts = [{ stdout: 'codex-cli 0.167.0' }, { stdout: 'Logged in using an API key - sk-…' }];
    expect(await getCodexCliStatus()).toBe('not_chatgpt_login');
  });

  test('not logged in, and a binary that does not run', async () => {
    scripts = [{ stdout: 'codex-cli 0.167.0' }, { code: 1, stderr: 'Not logged in' }];
    expect(await getCodexCliStatus()).toBe('not_logged_in');
    __resetCodexCliStatusForTests();
    scripts = [{ code: 127, stderr: 'codex: command not found' }];
    expect(await getCodexCliStatus()).toBe('missing');
  });
});

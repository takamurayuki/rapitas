/**
 * codex-cli-provider.login-guard.test
 *
 * Regressions from the routing2b G2 review (PR #1477):
 * 1. The ChatGPT-only rule (owner decision 1) must hold on EVERY call, not
 *    only at the first availability probe: a CODEX_HOME switched to an
 *    API-key login after a 'ready' probe is refused before `codex exec`
 *    runs, and `exec` itself is pinned with `forced_login_method="chatgpt"`.
 * 2. A failure reason printed only on stderr (stdout empty) must survive into
 *    the error, so quota / auth still reach the cooldown with their resumeAt.
 * `child_process` is mocked — no real CLI. The cooldown side is real
 * (juror-cli-cooldown → classifier → provider-cooldown).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';

process.env.RAPITAS_AUX_AI_CODEX_TIMEOUT_MS = '500';

type MutableStream = EventEmitter & { setEncoding: (enc: string) => void };
const makeStream = (): MutableStream =>
  Object.assign(new EventEmitter(), { setEncoding: () => {} }) as MutableStream;

interface Script {
  stdout?: string;
  stderr?: string;
  code?: number;
}

class MockChild extends EventEmitter {
  pid = 6161;
  stdout = makeStream();
  stderr = makeStream();
  kill = mock(() => {});
  stdin: EventEmitter & { end: (buf?: Buffer) => void };
  constructor(script: Script) {
    super();
    this.stdin = Object.assign(new EventEmitter(), {
      end: () => {
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
const spawnedArgs: string[][] = [];
mock.module('./aux-cli-launch', () => ({
  prepareAuxCli: async () => null,
  launcherEnv: (env: NodeJS.ProcessEnv) => env,
  LAUNCHER_TIMEOUT_ENV: 'RAPITAS_AUX_AI_CLI_TIMEOUT_MS',
}));
mock.module('child_process', () => ({
  spawn: mock((_cmd: string, args: string[]) => {
    spawnedArgs.push(args);
    return new MockChild(scripts.shift() ?? {}) as unknown as ChildProcess;
  }),
  execFileSync: mock(() => Buffer.from('')),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => {}),
}));
mock.module('../common/cli-path-resolver', () => ({
  resolveCliPathAsync: async (name: string) => name,
  getClaudePathAsync: async () => 'claude',
  __resetCliPathCacheForTests: () => {},
}));
mock.module('./aux-cli-cleanup', () => ({
  auxCliCleanup: { assertReady: () => {}, stop: () => true },
  createAuxCliCleanup: () => ({}),
  trackAuxCliChild: () => () => {},
}));

const { callCodexCli, getCodexCliStatus, isCodexCliAvailable, __resetCodexCliStatusForTests } =
  await import('./codex-cli-provider');
const { CodexCliUnavailableError } = await import('./cli-errors');
const { coolVendorAfterJurorFailure } =
  await import('../../services/agents/verification/juror-cli-cooldown');
const { __resetCooldowns, listActiveCooldowns } =
  await import('../../services/ai/provider-cooldown');

const CHATGPT: Script = { stdout: 'Logged in using ChatGPT' };
// Real 0.164.0-alpha.9 output after `codex login --with-api-key` (2026-11-11).
const API_KEY: Script = {
  stdout:
    'API key configured - sk-fake-***-0000\nAuthentication is checked when you send a request.',
};
const answer = (text: string): Script => ({
  stdout: [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join('\n'),
});
const ask = () => callCodexCli('gpt-6-astra', [{ role: 'user', content: 'x' }], undefined, 1);
const execCalls = () => spawnedArgs.filter((a) => a.includes('exec'));

beforeEach(() => {
  scripts = [];
  spawnedArgs.length = 0;
  __resetCodexCliStatusForTests();
  __resetCooldowns();
});
afterAll(() => {
  delete process.env.RAPITAS_AUX_AI_CODEX_TIMEOUT_MS;
  __resetCooldowns();
});

describe('ChatGPT login is enforced on every call (G2 finding 1)', () => {
  test('ready, then the same CODEX_HOME switches to an API key: refused, exec never runs', async () => {
    scripts = [{ stdout: 'codex-cli 0.164.0' }, CHATGPT];
    expect(await getCodexCliStatus()).toBe('ready');

    // First call on the ChatGPT login goes through.
    scripts = [CHATGPT, answer('fine')];
    expect((await ask()).content).toBe('fine');
    expect(execCalls()).toHaveLength(1);

    // The login is replaced by an API key (no restart, cache still 'ready').
    spawnedArgs.length = 0;
    scripts = [API_KEY, answer('must not be read')];
    const err = await ask().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexCliUnavailableError);
    expect((err as Error).message).toMatch(/not logged in with ChatGPT/i);
    expect(execCalls()).toHaveLength(0);

    // The seat stops being offered without waiting for a restart …
    expect(await getCodexCliStatus()).toBe('not_chatgpt_login');
    expect(await isCodexCliAvailable()).toBe(false);
    // … and the refusal cools openai as an auth failure.
    expect(coolVendorAfterJurorFailure(err, 'gpt-6-astra')).toMatchObject({
      provider: 'openai',
      reason: 'auth',
    });
  });

  test('a logged-out CODEX_HOME is refused the same way', async () => {
    scripts = [{ code: 1, stderr: 'Not logged in' }, answer('must not be read')];
    await expect(ask()).rejects.toThrow(/not logged in/i);
    expect(execCalls()).toHaveLength(0);
  });

  test('exec itself is pinned to the ChatGPT login (backstop for a switch mid-call)', async () => {
    scripts = [CHATGPT, answer('ok')];
    await ask();
    const exec = execCalls()[0];
    expect(exec.join(' ')).toContain('-c forced_login_method="chatgpt"');
  });
});

describe('stderr-only failure reasons survive (G2 finding 2)', () => {
  test('stdout empty, stderr "Not logged in": reason kept, openai cooled as auth', async () => {
    scripts = [CHATGPT, { code: 1, stderr: 'Not logged in. Run codex login.\n' }];
    const err = await ask().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexCliUnavailableError);
    expect((err as Error).message).toContain('Not logged in. Run codex login.');
    expect((err as Error).message).not.toContain('did not complete a turn');
    expect(coolVendorAfterJurorFailure(err, 'gpt-6-astra')).toMatchObject({ reason: 'auth' });
    expect(listActiveCooldowns().map((c) => [c.provider, c.reason])).toEqual([['openai', 'auth']]);
  });

  test('stdout empty, stderr quota with a time: reason, resumeAt and cooldown all carry it', async () => {
    scripts = [
      CHATGPT,
      {
        code: 1,
        stderr: "ERROR: You've hit your usage limit. Upgrade to Pro, or try again at 3:05 PM.",
      },
    ];
    const err = await ask().catch((e: unknown) => e);
    expect((err as Error).message).toContain('usage limit');
    const outcome = coolVendorAfterJurorFailure(err, 'gpt-6-astra');
    expect(outcome).toMatchObject({ provider: 'openai', reason: 'quota' });
    expect(outcome?.resetAt?.getMinutes()).toBe(5);
    const entry = listActiveCooldowns()[0];
    expect([entry.provider, entry.reason]).toEqual(['openai', 'quota']);
    expect(new Date(entry.until).getMinutes()).toBe(5);
  });

  test('a structured turn.failed still wins over stderr', async () => {
    scripts = [
      CHATGPT,
      {
        code: 1,
        stdout: JSON.stringify({ type: 'turn.failed', error: { message: 'structured reason' } }),
        stderr: 'noise on stderr',
      },
    ];
    const err = await ask().catch((e: unknown) => e);
    expect((err as Error).message).toContain('structured reason');
    expect((err as Error).message).not.toContain('noise on stderr');
  });

  test('stderr beats a mere warning item, which beats nothing', async () => {
    const warning = JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'error',
        message: 'Code Mode is unavailable because code-mode host is disabled.',
      },
    });
    scripts = [CHATGPT, { code: 1, stdout: warning, stderr: 'Not logged in' }];
    expect(((await ask().catch((e: unknown) => e)) as Error).message).toContain('Not logged in');

    scripts = [CHATGPT, { code: 1, stdout: warning }];
    expect(((await ask().catch((e: unknown) => e)) as Error).message).toContain('Code Mode');

    scripts = [CHATGPT, { code: 1 }];
    expect(((await ask().catch((e: unknown) => e)) as Error).message).toContain(
      'did not complete a turn',
    );
  });
});

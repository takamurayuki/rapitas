/**
 * agent-test-router.test.ts
 *
 * Unit tests for POST /agents/:id/test (legacy) and POST /agents/:id/test-connection
 * (newer). Covers: Codex CLI is not misdiagnosed as "API key missing", CLI-only
 * checks never report success:true without an actual CLI probe, and spawn()'s
 * synchronous throw (Windows Node EINVAL on .cmd shims) is handled alongside
 * the async 'error' event. child_process/config/secret-store/agent-audit-log
 * are stubbed via mock.module (process-global — run this file in isolation).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'events';

type FakeChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
};

function createFakeChildProcess(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = mock(() => {});
  return proc;
}

// Each entry describes how the next spawn() call should behave.
type SpawnBehavior =
  | { kind: 'throw'; error: Error }
  | { kind: 'success'; stdout: string }
  | { kind: 'exit-nonzero'; code: number; stderr: string }
  | { kind: 'async-error'; error: Error };

let nextBehavior: SpawnBehavior | null = null;

const mockSpawn = mock((_cmd: string, _args: string[], _opts: unknown) => {
  if (!nextBehavior) {
    throw new Error('test setup error: no spawn behavior queued');
  }
  const behavior = nextBehavior;
  nextBehavior = null;

  if (behavior.kind === 'throw') {
    throw behavior.error;
  }

  const proc = createFakeChildProcess();
  queueMicrotask(() => {
    if (behavior.kind === 'success') {
      proc.stdout.emit('data', Buffer.from(behavior.stdout));
      proc.emit('close', 0);
    } else if (behavior.kind === 'exit-nonzero') {
      proc.stderr.emit('data', Buffer.from(behavior.stderr));
      proc.emit('close', behavior.code);
    } else if (behavior.kind === 'async-error') {
      proc.emit('error', behavior.error);
    }
  });
  return proc;
});

mock.module('child_process', () => ({ spawn: mockSpawn }));

const mockFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../../config', () => ({
  prisma: { aIAgentConfig: { findUnique: mockFindUnique } },
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} },
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  }),
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => false,
  getProjectRoot: () => '/tmp',
}));

mock.module('../../../utils/common/secret-store', () => ({
  isKeychainSecretRef: () => false,
  saveProviderApiKey: () => 'stub',
  saveAgentApiKey: () => 'stub',
  saveSecret: () => 'stub',
  resolveStoredSecret: () => 'stub-api-key',
  deleteStoredSecret: () => {},
  maskStoredSecret: () => null,
}));

mock.module('../../../utils/agent/agent-audit-log', () => ({
  logAgentConfigChange: () => Promise.resolve(),
  getAgentConfigAuditLogs: () => Promise.resolve([]),
  getRecentAuditLogs: () => Promise.resolve([]),
  calculateChanges: () => ({}),
}));

const { agentTestRouter } = await import('./agent-test-router');

function agentRecord(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 1,
    agentType: 'codex',
    apiKeyEncrypted: null,
    modelId: null,
    endpoint: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockSpawn.mockClear();
  nextBehavior = null;
});

describe('POST /agents/:id/test-connection — Codex CLI (OAuth, no API key)', () => {
  it('does not misdiagnose a key-less Codex agent as "API key missing" when the CLI is available', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'codex', apiKeyEncrypted: null }),
    );
    nextBehavior = { kind: 'success', stdout: 'codex-cli 0.153.4' };

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test-connection', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean; message: string; agentType: string };

    expect(body.success).toBe(true);
    expect(body.message).not.toContain('APIキーが設定されていません');
    expect(body.message).toContain('未検証');
  });

  it('reports failure (not "API key missing") when the Codex CLI cannot be spawned (ENOENT)', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'codex', apiKeyEncrypted: null }),
    );
    nextBehavior = {
      kind: 'async-error',
      error: Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }),
    };

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test-connection', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean; message: string };

    expect(body.success).toBe(false);
    expect(body.message).not.toContain('APIキーが設定されていません');
    expect(body.message).toContain('ENOENT');
  });

  it('does not report success:true from a bare CLI --version exit-nonzero result', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'codex', apiKeyEncrypted: null }),
    );
    nextBehavior = { kind: 'exit-nonzero', code: 1, stderr: 'unexpected failure' };

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test-connection', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean };

    expect(body.success).toBe(false);
  });
});

describe('POST /agents/:id/test-connection — Windows Node sync-throw handling (EINVAL)', () => {
  it('handles a synchronous spawn() throw (Node/.cmd shim EINVAL) without leaving the promise unsettled', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'codex', apiKeyEncrypted: null }),
    );
    nextBehavior = {
      kind: 'throw',
      error: Object.assign(new Error('spawn codex.cmd EINVAL'), { code: 'EINVAL' }),
    };

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test-connection', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean; message: string };

    expect(body.success).toBe(false);
    expect(body.message).toContain('EINVAL');
  });

  it('legacy /test endpoint also survives a synchronous spawn() throw for claude-code', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'claude-code', apiKeyEncrypted: null }),
    );
    nextBehavior = {
      kind: 'throw',
      error: Object.assign(new Error('spawn claude.cmd EINVAL'), { code: 'EINVAL' }),
    };

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean; message: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message).toContain('EINVAL');
  });
});

describe('POST /agents/:id/test-connection — unimplemented probes never report success', () => {
  it('returns success:false with an "not yet implemented" message for an API-key agent type with no probe', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'anthropic-api', apiKeyEncrypted: 'encrypted-value' }),
    );

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test-connection', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean; message: string };

    expect(body.success).toBe(false);
    expect(body.message).toContain('実装されていません');
  });

  it('still requires an API key for API-only agent types (e.g. openai) — regression guard', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'openai', apiKeyEncrypted: null }),
    );

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test-connection', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean; message: string };

    expect(body.success).toBe(false);
    expect(body.message).toBe('APIキーが設定されていません');
  });
});

describe('POST /agents/:id/test — legacy endpoint regression guard', () => {
  it('keeps testing Codex via CLI check regardless of apiKeyEncrypted (unchanged behavior)', async () => {
    mockFindUnique.mockResolvedValueOnce(
      agentRecord({ agentType: 'codex', apiKeyEncrypted: null }),
    );
    nextBehavior = { kind: 'success', stdout: 'codex-cli 0.153.4' };

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/1/test', { method: 'POST' }),
    );
    const body = (await res.json()) as { success: boolean; message: string };

    expect(body.success).toBe(true);
    expect(body.message).toContain('Codex CLI');
  });

  it('returns 404 for a missing agent', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const res = await agentTestRouter.handle(
      new Request('http://localhost/agents/999/test', { method: 'POST' }),
    );

    expect(res.status).toBe(404);
  });
});

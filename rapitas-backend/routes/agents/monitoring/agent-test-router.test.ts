/**
 * Agent Test Router テスト
 *
 * POST /agents/:id/test-connection の診断分岐（codexのCLI検出→ログイン確認の
 * 2段階診断、CLI無し/timeout/Windows shim/旧API互換/未実装パス回帰/claude-code回帰）
 * を検証する。
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { Elysia } from 'elysia';

interface SpawnCall {
  command: string;
  args: string[];
}

type SpawnBehavior = 'success' | 'error' | 'timeout' | 'throw';

// Behaviors are consumed in spawn-call order — call 1 (CLI存在確認) uses
// spawnBehaviors[0], call 2 (認証確認等) uses spawnBehaviors[1]. A shorter
// array than the number of spawn calls falls back to 'success' for the rest.
let spawnBehaviors: SpawnBehavior[] = ['success'];
let spawnCalls: SpawnCall[] = [];

function createFakeChild(behavior: SpawnBehavior) {
  return {
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    kill: mock(() => {}),
    on: (event: string, cb: (arg?: unknown) => void) => {
      if (event === 'close' && behavior === 'success') {
        setTimeout(() => cb(0), 0);
      } else if (event === 'error' && behavior === 'error') {
        setTimeout(() => cb(new Error('command not found')), 0);
      }
      // behavior === 'timeout' never calls close/error — the router's own
      // setTimeout(10000) branch must fire instead.
    },
  };
}

const mockPrisma = {
  aIAgentConfig: {
    findUnique: mock(() => Promise.resolve<Record<string, unknown> | null>(null)),
  },
};

mock.module('../../../config', () => ({
  prisma: mockPrisma,
}));
mock.module('../../../utils/common/secret-store', () => ({
  resolveStoredSecret: mock(() => 'decrypted-api-key'),
}));
mock.module('../../../utils/agent/agent-audit-log', () => ({
  logAgentConfigChange: mock(() => Promise.resolve()),
}));
mock.module('child_process', () => ({
  spawn: mock((command: string, args: string[]) => {
    const callIndex = spawnCalls.length;
    spawnCalls.push({ command, args });
    const behavior = spawnBehaviors[callIndex] ?? 'success';
    if (behavior === 'throw') {
      throw new Error('EINVAL: spawn shim rejected');
    }
    return createFakeChild(behavior);
  }),
}));

const { agentTestRouter } = await import('./agent-test-router');

interface TestConnectionDetails {
  checkLevel?: string;
  cliCheck?: { success: boolean; message: string };
  authCheck?: { success: boolean; message: string };
}

interface TestConnectionResponse {
  success: boolean;
  agentType?: string;
  message?: string;
  error?: string;
  details?: TestConnectionDetails;
}

function buildAgent(overrides: Record<string, unknown>) {
  return {
    id: 1,
    agentType: 'codex',
    apiKeyEncrypted: null,
    endpoint: null,
    modelId: null,
    ...overrides,
  };
}

async function postTestConnection(app: Elysia): Promise<TestConnectionResponse> {
  const response = await app.handle(
    new Request('http://localhost/agents/1/test-connection', { method: 'POST' }),
  );
  return (await response.json()) as TestConnectionResponse;
}

describe('Agent Test Router — POST /agents/:id/test-connection', () => {
  let app: Elysia;
  const originalPlatform = process.platform;

  beforeEach(() => {
    spawnBehaviors = ['success'];
    spawnCalls = [];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve<Record<string, unknown> | null>(null),
    );
    app = new Elysia().use(agentTestRouter);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('codexでapiKeyEncrypted無しでもAPIキー不足と誤診断しない', async () => {
    spawnBehaviors = ['success', 'success'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.message).not.toContain('APIキーが設定されていません');
  });

  it('CLI検出成功・認証確認成功でsuccess:trueかつchecklevelがcli_and_auth', async () => {
    spawnBehaviors = ['success', 'success'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(true);
    expect(data.message).toContain('認証済み接続');
    expect(data.details?.checkLevel).toBe('cli_and_auth');
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1].args).toEqual(['login', 'status']);
  });

  it('CLI検出成功・認証確認失敗でsuccess:falseかつchecklevelがcli_only', async () => {
    spawnBehaviors = ['success', 'error'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(false);
    expect(data.message).toContain('ログイン状態を確認できませんでした');
    expect(data.details?.checkLevel).toBe('cli_only');
    expect(spawnCalls).toHaveLength(2);
  });

  it('CLI検出失敗の場合、認証確認は呼ばれずsuccess:falseかつnot foundを含む', async () => {
    spawnBehaviors = ['error'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(false);
    expect(data.message).toContain('not found');
    expect(spawnCalls).toHaveLength(1);
  });

  it('timeout（認証確認段階、10秒超過相当）でsuccess:falseかつtimeoutを含む', async () => {
    spawnBehaviors = ['success', 'timeout'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    const originalSetTimeout = global.setTimeout;
    // Fire the router's 10s timeout immediately instead of waiting real time.
    global.setTimeout = ((callback: () => void, _delay?: number) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;

    try {
      const start = Date.now();
      const data = await postTestConnection(app);
      const elapsedMs = Date.now() - start;

      expect(data.success).toBe(false);
      expect(data.message).toContain('timeout');
      expect(elapsedMs).toBeLessThan(1000);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it('Windows環境でcodexの既定パスがcodex.cmdになる', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    // CODEX_CLI_PATH may be set in .env — clear it so the isWindows default kicks in.
    const originalCodexCliPath = process.env.CODEX_CLI_PATH;
    delete process.env.CODEX_CLI_PATH;
    spawnBehaviors = ['success', 'success'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    try {
      await postTestConnection(app);

      expect(spawnCalls[0].command).toBe('codex.cmd');
    } finally {
      if (originalCodexCliPath !== undefined) {
        process.env.CODEX_CLI_PATH = originalCodexCliPath;
      }
    }
  });

  it('spawn()自体が同期throwする場合、外側catchがsuccess:falseで応答する', async () => {
    spawnBehaviors = ['throw'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(false);
    expect(data.message).toContain('接続テストに失敗しました');
  });

  it('旧API互換: レスポンスのsuccess/agentType/messageフィールド名・型が維持される（claude-code成功）', async () => {
    spawnBehaviors = ['success'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'claude-code', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(typeof data.success).toBe('boolean');
    expect(typeof data.agentType).toBe('string');
    expect(typeof data.message).toBe('string');
    expect(data.agentType).toBe('claude-code');
  });

  it('旧API互換: レスポンスのsuccess/agentType/messageフィールド名・型が維持される（codex成功）', async () => {
    spawnBehaviors = ['success', 'success'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'codex', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(typeof data.success).toBe('boolean');
    expect(typeof data.agentType).toBe('string');
    expect(typeof data.message).toBe('string');
    expect(data.agentType).toBe('codex');
  });

  it('未実装パス回帰防止: apiKeyEncryptedありのopenaiはsuccess:falseのまま', async () => {
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'openai', apiKeyEncrypted: 'encrypted-key' })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(false);
    expect(data.message).toContain('まだ実装されていません');
  });

  it('未実装パス回帰防止: apiKeyEncryptedありのgeminiはsuccess:falseのまま', async () => {
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'gemini', apiKeyEncrypted: 'encrypted-key' })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(false);
    expect(data.message).toContain('まだ実装されていません');
  });

  it('回帰防止: apiKeyEncryptedなしのanthropic-apiはAPIキー不足のままsuccess:false', async () => {
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'anthropic-api', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(false);
    expect(data.message).toContain('APIキーが設定されていません');
  });

  it('geminiでapiKeyEncrypted無しの場合はCLI検出のみでsuccess:trueかつ接続成功と表示しない', async () => {
    spawnBehaviors = ['success'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'gemini', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('gemini');
    expect(data.success).toBe(true);
    expect(data.message).not.toContain('接続成功');
    expect(data.message).toContain('認証状態は未検証');
    expect(data.details?.checkLevel).toBe('cli_only');
  });

  it('claude-codeでCLI検出成功の場合、接続成功と表示せず認証状態は未検証と示す', async () => {
    spawnBehaviors = ['success'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'claude-code', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(true);
    expect(data.message).not.toContain('接続成功');
    expect(data.message).toContain('認証状態は未検証');
    expect(data.details?.checkLevel).toBe('cli_only');
  });

  it('claude-code分岐は既存どおり動作する（失敗ケース）', async () => {
    spawnBehaviors = ['error'];
    mockPrisma.aIAgentConfig.findUnique = mock(() =>
      Promise.resolve(buildAgent({ agentType: 'claude-code', apiKeyEncrypted: null })),
    );

    const data = await postTestConnection(app);

    expect(data.success).toBe(false);
    expect(data.message).toContain('Claude Code CLI接続失敗');
  });
});

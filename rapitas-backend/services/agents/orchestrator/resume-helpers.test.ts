/**
 * resume-helpers.test
 *
 * Covers buildResumePrompt (prompt assembly branches) and resolveAgentConfig
 * (DB-config resolution + API key decrypt success/failure paths).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// NOTE: Mirror every runtime export of config/index.ts (the barrel resume-helpers
// imports createLogger from) — mock.module is process-global, so a partial mock
// would break any other test file that imports the untouched exports later in
// the same bun test run.
const errorCalls: unknown[][] = [];
mock.module('../../../config', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: (...args: unknown[]) => {
      errorCalls.push(args);
    },
    debug: () => {},
    fatal: () => {},
  }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} },
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => '/repo',
}));

// NOTE: Mirror every runtime export of agent-factory.ts. narrowAgentType keeps
// real narrow-to-fallback semantics so resolveAgentConfig's use of it is
// genuinely exercised; the class/instance exports are stubbed since instantiating
// the real AgentFactory pulls in the CLI agent implementations (unrelated to this
// unit's logic).
const VALID_TYPES = ['claude-code', 'codex', 'gemini', 'custom'];
mock.module('../agent-factory', () => ({
  AGENT_TYPES: VALID_TYPES,
  isAgentType: (s: unknown) => VALID_TYPES.includes(s as string),
  narrowAgentType: (s: string | null | undefined, fallback = 'claude-code') =>
    s && VALID_TYPES.includes(s) ? s : fallback,
  AgentFactory: { getInstance: () => ({ createAgent: () => ({}), removeAgent: async () => true }) },
  agentFactory: { createAgent: () => ({}), removeAgent: async () => true },
}));

// resolveStoredSecret is the only secret-store export resume-helpers uses;
// mirror the rest of the module's real exports so other consumers loaded in
// the same test run are unaffected.
let resolveStoredSecretImpl: (v: string | null | undefined) => string | null = () => null;
mock.module('../../../utils/common/secret-store', () => ({
  isKeychainSecretRef: () => false,
  saveProviderApiKey: () => '',
  saveAgentApiKey: () => '',
  saveSecret: () => '',
  resolveStoredSecret: (v: string | null | undefined) => resolveStoredSecretImpl(v),
  deleteStoredSecret: () => {},
  maskStoredSecret: () => null,
}));

const { buildResumePrompt, resolveAgentConfig } = await import('./resume-helpers');

beforeEach(() => {
  errorCalls.length = 0;
  resolveStoredSecretImpl = () => null;
});

describe('buildResumePrompt', () => {
  const task = { title: 'タスクA', description: '説明文' };

  test('includes title, description, and last output', () => {
    const prompt = buildResumePrompt(task, 'previous output tail', '', null);
    expect(prompt).toContain('タスクA');
    expect(prompt).toContain('説明文');
    expect(prompt).toContain('previous output tail');
  });

  test('falls back to "なし" when description is null', () => {
    const prompt = buildResumePrompt({ title: 'T', description: null }, '', '', null);
    expect(prompt).toContain('説明: なし');
  });

  test('includes a recent-log section when logSummary is non-empty', () => {
    const prompt = buildResumePrompt(task, '', 'log line 1\nlog line 2', null);
    expect(prompt).toContain('## 直近のログ');
    expect(prompt).toContain('log line 1\nlog line 2');
  });

  test('omits the recent-log section when logSummary is empty/whitespace-only', () => {
    const promptEmpty = buildResumePrompt(task, '', '', null);
    const promptBlank = buildResumePrompt(task, '', '   \n  ', null);
    expect(promptEmpty).not.toContain('## 直近のログ');
    expect(promptBlank).not.toContain('## 直近のログ');
  });

  test('includes an interruption-reason section only when errorMessage is provided', () => {
    const withError = buildResumePrompt(task, '', '', 'timeout after 30s');
    const withoutError = buildResumePrompt(task, '', '', null);
    expect(withError).toContain('## 中断理由');
    expect(withError).toContain('timeout after 30s');
    expect(withoutError).not.toContain('## 中断理由');
  });

  test('includes a workflow-status section when workflowStatus is provided', () => {
    const prompt = buildResumePrompt(task, '', '', null, 'plan_approved');
    expect(prompt).toContain('## 現在のワークフロー状態');
    expect(prompt).toContain('plan_approved');
  });

  test('omits the workflow-status section when workflowStatus is null/omitted', () => {
    const withoutArg = buildResumePrompt(task, '', '', null);
    const withNull = buildResumePrompt(task, '', '', null, null);
    expect(withoutArg).not.toContain('## 現在のワークフロー状態');
    expect(withNull).not.toContain('## 現在のワークフロー状態');
  });
});

describe('resolveAgentConfig', () => {
  const fallback = {
    type: 'claude-code' as const,
    name: 'fallback-agent',
    workingDirectory: '/work',
    timeout: 60000,
  };

  function makeCtx(dbConfig: unknown) {
    return {
      prisma: {
        aIAgentConfig: {
          findUnique: mock(() => Promise.resolve(dbConfig)),
        },
      },
      // Only prisma is exercised by resolveAgentConfig; other OrchestratorContext
      // fields are irrelevant to this unit.
    } as unknown as Parameters<typeof resolveAgentConfig>[0];
  }

  test('returns the fallback unchanged when no DB record is found', async () => {
    const ctx = makeCtx(null);
    const result = await resolveAgentConfig(ctx, 42, fallback, null);
    expect(result).toBe(fallback);
  });

  test('maps DB fields onto AgentConfigInput, defaulting null endpoint/modelId to undefined', async () => {
    const ctx = makeCtx({
      id: 1,
      agentType: 'gemini',
      name: 'db-agent',
      endpoint: null,
      apiKeyEncrypted: null,
      modelId: null,
    });

    const result = await resolveAgentConfig(ctx, 1, fallback, null);

    expect(result.type).toBe('gemini');
    expect(result.name).toBe('db-agent');
    expect(result.endpoint).toBeUndefined();
    expect(result.modelId).toBeUndefined();
    expect(result.apiKey).toBeUndefined();
    expect(result.workingDirectory).toBe('/work');
    expect(result.timeout).toBe(60000);
    expect(result.dangerouslySkipPermissions).toBe(true);
    expect(result.yoloMode).toBe(true);
    expect(result.continueConversation).toBe(false);
    expect(result.resumeSessionId).toBeUndefined();
  });

  test('falls back to claude-code for an unrecognized DB agentType', async () => {
    const ctx = makeCtx({
      id: 2,
      agentType: 'not-a-real-type',
      name: 'db-agent',
      endpoint: 'https://x',
      apiKeyEncrypted: null,
      modelId: 'model-x',
    });

    const result = await resolveAgentConfig(ctx, 2, fallback, null);

    expect(result.type).toBe('claude-code');
    expect(result.endpoint).toBe('https://x');
    expect(result.modelId).toBe('model-x');
  });

  test('decrypts apiKeyEncrypted via resolveStoredSecret when present', async () => {
    resolveStoredSecretImpl = () => 'plain-api-key';
    const ctx = makeCtx({
      id: 3,
      agentType: 'claude-code',
      name: 'db-agent',
      endpoint: null,
      apiKeyEncrypted: 'encrypted-blob',
      modelId: null,
    });

    const result = await resolveAgentConfig(ctx, 3, fallback, null);

    expect(result.apiKey).toBe('plain-api-key');
  });

  test('leaves apiKey undefined and logs an error when decryption throws', async () => {
    resolveStoredSecretImpl = () => {
      throw new Error('decrypt failed');
    };
    const ctx = makeCtx({
      id: 4,
      agentType: 'claude-code',
      name: 'db-agent',
      endpoint: null,
      apiKeyEncrypted: 'corrupt-blob',
      modelId: null,
    });

    const result = await resolveAgentConfig(ctx, 4, fallback, null);

    expect(result.apiKey).toBeUndefined();
    expect(errorCalls.length).toBe(1);
  });

  test('sets resumeSessionId from claudeSessionId when provided', async () => {
    const ctx = makeCtx({
      id: 5,
      agentType: 'claude-code',
      name: 'db-agent',
      endpoint: null,
      apiKeyEncrypted: null,
      modelId: null,
    });

    const result = await resolveAgentConfig(ctx, 5, fallback, 'session-abc');

    expect(result.resumeSessionId).toBe('session-abc');
  });

  test('queries aIAgentConfig.findUnique with the given agentConfigId', async () => {
    const findUnique = mock(() => Promise.resolve(null));
    const ctx = {
      prisma: { aIAgentConfig: { findUnique } },
    } as unknown as Parameters<typeof resolveAgentConfig>[0];

    await resolveAgentConfig(ctx, 77, fallback, null);

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 77 } });
  });
});

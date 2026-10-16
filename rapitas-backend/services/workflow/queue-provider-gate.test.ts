/**
 * queue-provider-gate テスト
 *
 * プロバイダ枯渇時にキューを止める判定と、再試行を消費しない判定を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const findMany = mock(() => Promise.resolve([{ agentType: 'claude-code' }]));
mock.module('../../config/database', () => ({ prisma: { aIAgentConfig: { findMany } } }));

const cooling = new Set<string>();
// NOTE: bun's mock.module replaces the WHOLE module, so every export another
// importer relies on (agent-fallback pulls markProviderCooldown) must be
// mirrored or the import fails at load time.
mock.module('../ai/provider-cooldown', () => ({
  isProviderInCooldown: (p: string) => cooling.has(p),
  markProviderCooldown: mock(() => {}),
  clearCooldown: mock(() => {}),
  listActiveCooldowns: mock(() => []),
  listFailureStreaks: mock(() => []),
  recordProviderSuccess: mock(() => {}),
  inferProviderFromModelName: mock(() => null),
  __resetCooldowns: mock(() => {}),
}));

const { hasUsableProvider, isProviderOutageFailure } = await import('./queue-provider-gate');

beforeEach(() => {
  cooling.clear();
  findMany.mockClear();
});

describe('isProviderOutageFailure', () => {
  test('spend limit / rate limit はプロバイダ側障害', async () => {
    expect(
      await isProviderOutageFailure(
        "You've hit your monthly spend limit. claude.ai/settings/usage",
      ),
    ).toBe(true);
    expect(await isProviderOutageFailure('Anthropic API error: rate_limit_error')).toBe(true);
    expect(await isProviderOutageFailure('googleapis: RESOURCE_EXHAUSTED')).toBe(true);
  });

  test('ワークフロー起因の失敗は対象外（従来どおり再試行を消費する）', async () => {
    expect(await isProviderOutageFailure('research.md was not saved.')).toBe(false);
    expect(
      await isProviderOutageFailure('Agent output a plan but no actual code changes were made.'),
    ).toBe(false);
    expect(await isProviderOutageFailure(null)).toBe(false);
    expect(await isProviderOutageFailure('')).toBe(false);
  });

  test('auth 失敗は対象外 — 再試行しても人が直すまで直らない', async () => {
    expect(await isProviderOutageFailure('Anthropic API error: invalid api key')).toBe(false);
  });
});

describe('hasUsableProvider', () => {
  test('cooldown が無ければ実行可能', async () => {
    expect(await hasUsableProvider()).toBe(true);
  });

  test('唯一のプロバイダが cooldown 中なら実行不可', async () => {
    cooling.add('claude');
    expect(await hasUsableProvider()).toBe(false);
  });

  test('別プロバイダが生きていれば実行可能', async () => {
    cooling.add('claude');
    findMany.mockImplementationOnce(() =>
      Promise.resolve([{ agentType: 'claude-code' }, { agentType: 'gemini-cli' }]),
    );
    expect(await hasUsableProvider()).toBe(true);
  });

  test('設定が無い / 参照が失敗した場合は fail-open', async () => {
    findMany.mockImplementationOnce(() => Promise.resolve([]));
    expect(await hasUsableProvider()).toBe(true);
    findMany.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    expect(await hasUsableProvider()).toBe(true);
  });
});

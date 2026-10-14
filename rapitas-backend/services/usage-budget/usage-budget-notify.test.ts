/**
 * usage-budget-notify unit tests
 *
 * Verifies the `usage_budget_threshold` notification for 80% / 90% / exceeded:
 * type, link, level-specific title and a body carrying the forecast remaining.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const createNotification = mock((_p: unknown) => Promise.resolve({ id: 1 }));
mock.module('../communication/notification-service', () => ({ createNotification }));

import { buildThresholdMessage, notifyUsageBudgetThreshold } from './usage-budget-notify';
import type { PendingPrompt } from './usage-budget-types';

function prompt(overrides: Partial<PendingPrompt> = {}): PendingPrompt {
  return {
    key: '2026-10:warn80',
    level: 'warn80',
    unit: 'tokens',
    used: 800_000,
    limit: 1_000_000,
    remaining: 200_000,
    avg7: 50_000,
    daysToExhaust: 4,
    projectedMonthEnd: 1_850_000,
    ...overrides,
  };
}

beforeEach(() => {
  createNotification.mockReset();
  createNotification.mockImplementation(() => Promise.resolve({ id: 1 }));
});

describe('buildThresholdMessage', () => {
  test.each([
    ['warn80', '80%'],
    ['warn90', '90%'],
    ['exceeded', '超過'],
  ] as const)('%s title mentions %s', (level, word) => {
    expect(buildThresholdMessage(prompt({ level })).title).toContain(word);
  });

  test('body includes the remaining amount and the 7-day forecast', () => {
    const { message } = buildThresholdMessage(prompt());
    expect(message).toContain('残り 200,000 トークン');
    expect(message).toContain('約 4 日で上限に達する見込み');
    expect(message).toContain('実行は停止しません');
  });

  test('says the forecast is unavailable without recent usage', () => {
    const { message } = buildThresholdMessage(prompt({ avg7: 0, daysToExhaust: null }));
    expect(message).toContain('予測できません');
  });

  test('uses 回 for the executions unit', () => {
    const { message } = buildThresholdMessage(
      prompt({ unit: 'executions', used: 8, limit: 10, remaining: 2, avg7: 1 }),
    );
    expect(message).toContain('残り 2 回');
  });
});

describe('notifyUsageBudgetThreshold', () => {
  test('creates a usage_budget_threshold notification linking to the dashboard', async () => {
    await notifyUsageBudgetThreshold(prompt({ level: 'warn90', key: '2026-10:warn90' }));
    expect(createNotification).toHaveBeenCalledTimes(1);
    const arg = createNotification.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.type).toBe('usage_budget_threshold');
    expect(arg.link).toBe('/agents/usage-budget');
    expect(arg.metadata).toMatchObject({ key: '2026-10:warn90', remaining: 200_000 });
  });

  test('propagates a failure so the caller can roll back its claim', async () => {
    createNotification.mockImplementation(() => Promise.reject(new Error('boom')));
    await expect(notifyUsageBudgetThreshold(prompt())).rejects.toThrow('boom');
  });
});

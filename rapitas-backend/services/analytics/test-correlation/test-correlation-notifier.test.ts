/**
 * test-correlation-notifier.test.ts
 *
 * Unit tests for services/analytics/test-correlation/test-correlation-notifier.ts.
 * sendWebhookNotification is mocked via mock.module (bun's mock is process-global —
 * this file must be run in isolation, per the repo's parallel-test.ts convention).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const sendWebhookNotification = mock(() => Promise.resolve());
mock.module('../../communication/webhook-notification-service', () => ({
  sendWebhookNotification,
}));

const { buildTestRiskMessage, notifyPrTestRisk, NOTIFY_TOP_N } =
  await import('./test-correlation-notifier');
import type { PrTestRiskEntry } from './pr-test-risk';

function entry(overrides: Partial<PrTestRiskEntry> = {}): PrTestRiskEntry {
  return {
    testFile: 'a.test.ts',
    riskScore: 0.8,
    confidence: 'high',
    nonDeterministic: false,
    contributingFiles: ['a.ts'],
    ...overrides,
  };
}

beforeEach(() => {
  sendWebhookNotification.mockClear();
});

describe('buildTestRiskMessage', () => {
  test('reports no risky tests when the list is empty', () => {
    expect(buildTestRiskMessage(42, [])).toContain('検出されませんでした');
  });

  test('includes confidence label and risk percentage for each entry', () => {
    const message = buildTestRiskMessage(42, [entry({ riskScore: 0.75, confidence: 'medium' })]);
    expect(message).toContain('a.test.ts');
    expect(message).toContain('75%');
    expect(message).toContain('中');
  });

  test('flags non-deterministic tests explicitly', () => {
    const message = buildTestRiskMessage(42, [entry({ nonDeterministic: true })]);
    expect(message).toContain('環境依存/非決定的の可能性あり');
  });

  test('caps the listed entries at NOTIFY_TOP_N', () => {
    const entries = Array.from({ length: NOTIFY_TOP_N + 5 }, (_, i) =>
      entry({ testFile: `t${i}.test.ts` }),
    );
    const message = buildTestRiskMessage(42, entries);
    expect(message).not.toContain(`t${NOTIFY_TOP_N + 4}.test.ts`);
    expect(message).toContain(`t${NOTIFY_TOP_N - 1}.test.ts`);
  });
});

describe('notifyPrTestRisk', () => {
  test('sends a test_failure_correlation_alert webhook event with the built message and PR URL', async () => {
    await notifyPrTestRisk(42, [entry()], 'https://github.com/org/repo/pull/42');

    expect(sendWebhookNotification).toHaveBeenCalledTimes(1);
    const [event, data] = sendWebhookNotification.mock.calls[0];
    expect(event).toBe('test_failure_correlation_alert');
    expect(data.url).toBe('https://github.com/org/repo/pull/42');
    expect(data.message).toContain('a.test.ts');
  });
});

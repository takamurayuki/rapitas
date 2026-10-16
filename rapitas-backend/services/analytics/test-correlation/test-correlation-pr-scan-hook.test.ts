/**
 * test-correlation-pr-scan-hook.test
 *
 * Unit tests for scanPrTestRiskAfterCreate. The webhook sender is mocked via
 * mock.module (process-global in bun — run this file in isolation) and gh is
 * injected through the runGh parameter, so no real gh call or notification occurs.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const sendWebhookNotification = mock(() => Promise.resolve());
mock.module('../../communication/webhook-notification-service', () => ({
  sendWebhookNotification,
}));

const { scanPrTestRiskAfterCreate } = await import('./test-correlation-pr-scan-hook');

beforeEach(() => {
  sendWebhookNotification.mockClear();
});

describe('scanPrTestRiskAfterCreate', () => {
  test('fetches the PR changed files and sends a test_failure_correlation_alert notification', async () => {
    const calls: string[][] = [];
    const runGh = async (args: string[]) => {
      calls.push(args);
      return JSON.stringify({ files: [{ path: 'services/a.ts' }] });
    };

    await scanPrTestRiskAfterCreate(42, 'https://example.test/pull/42', '/repo', runGh);

    expect(calls).toEqual([['pr', 'view', '42', '--json', 'files']]);
    expect(sendWebhookNotification).toHaveBeenCalledTimes(1);
    const [eventType, payload] = sendWebhookNotification.mock.calls[0] as unknown as [
      string,
      { message: string; url?: string },
    ];
    expect(eventType).toBe('test_failure_correlation_alert');
    expect(payload.message).toContain('PR #42');
    expect(payload.url).toBe('https://example.test/pull/42');
  });

  test('swallows gh failures and sends no notification (fail-open)', async () => {
    const runGh = async (): Promise<string> => {
      throw new Error('gh: not authenticated');
    };

    await expect(scanPrTestRiskAfterCreate(7, undefined, '/repo', runGh)).resolves.toBeUndefined();
    expect(sendWebhookNotification).not.toHaveBeenCalled();
  });

  test('swallows unparsable gh output and sends no notification (fail-open)', async () => {
    const runGh = async (): Promise<string> => 'not json';

    await expect(scanPrTestRiskAfterCreate(8, undefined, '/repo', runGh)).resolves.toBeUndefined();
    expect(sendWebhookNotification).not.toHaveBeenCalled();
  });

  test('swallows notification failures so PR creation is never affected', async () => {
    sendWebhookNotification.mockImplementationOnce(() => Promise.reject(new Error('webhook down')));
    const runGh = async (): Promise<string> => JSON.stringify({ files: [] });

    await expect(scanPrTestRiskAfterCreate(9, undefined, '/repo', runGh)).resolves.toBeUndefined();
  });
});

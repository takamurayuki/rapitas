/**
 * i18n-integrity-scheduler.test
 *
 * Verifies the scheduler's summary log level: the per-file WARN in
 * i18n-integrity-check already reports each restore, so the scheduler summary
 * must not raise a second WARN (which was filed as a duplicate concern).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const calls: { level: string; msg: string }[] = [];
const make = (level: string) => (ctx: unknown, msg?: string) => {
  calls.push({ level, msg: typeof ctx === 'string' ? ctx : (msg ?? '') });
};
const fakeLogger = {
  debug: make('debug'),
  info: make('info'),
  warn: make('warn'),
  error: make('error'),
};

let outcome: Record<string, string> = {};
mock.module('../../config/logger', () => ({ createLogger: () => fakeLogger }));
mock.module('../../config', () => ({ getProjectRoot: () => '/tmp/x' }));
mock.module('../system/i18n-integrity-check', () => ({
  checkAndHealAllMessagesFiles: async () => outcome,
}));

const { I18nIntegrityScheduler } = await import('./i18n-integrity-scheduler');

type Runnable = { runCheck(dir: string): Promise<void> };

describe('I18nIntegrityScheduler.runCheck', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test('reports healed files at info, not warn', async () => {
    outcome = { 'messages/ja.json': 'healed' };
    await (new I18nIntegrityScheduler() as unknown as Runnable).runCheck('/tmp/x');
    const healed = calls.filter((c) => c.msg.includes('Healed reverted'));
    expect(healed.length).toBe(1);
    expect(healed[0].level).toBe('info');
    expect(calls.some((c) => c.level === 'warn')).toBe(false);
  });

  test('stays at debug when nothing healed', async () => {
    outcome = { 'messages/ja.json': 'ok' };
    await (new I18nIntegrityScheduler() as unknown as Runnable).runCheck('/tmp/x');
    expect(calls.every((c) => c.level === 'debug')).toBe(true);
  });
});

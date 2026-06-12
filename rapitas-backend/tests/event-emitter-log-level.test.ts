/**
 * event-emitter-log-level.test.ts
 *
 * Verifies that handler exceptions are logged at the warn level (not error).
 * Uses mock.module so the mocked createLogger is in place before event-emitter
 * evaluates `const log = createLogger(...)` at module load time.
 */
import { mock, describe, test, expect } from 'bun:test';

// Capture log-level calls before any module that uses the logger is imported.
const warnCalls: Array<{ meta: unknown; msg: string }> = [];
const errorCalls: Array<{ meta: unknown; msg: string }> = [];

// NOTE: mock.module is hoisted by Bun before static imports are resolved.
// The dynamic import below ensures event-emitter.ts sees our mock logger when
// it runs `const log = createLogger('agent-event-emitter')`.
mock.module('../config/logger', () => ({
  createLogger: (_name: string) => ({
    warn: (meta: unknown, msg: string) => warnCalls.push({ meta, msg }),
    error: (meta: unknown, msg: string) => errorCalls.push({ meta, msg }),
    info: () => {},
    debug: () => {},
    fatal: () => {},
  }),
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
  getBackendLogFilePath: () => '',
}));

const { AgentEventEmitter } = await import('../services/agents/abstraction/event-emitter');

describe('AgentEventEmitter - ハンドラーエラーのログレベル', () => {
  test('type-specific ハンドラーエラーは warn レベルで記録されること', async () => {
    warnCalls.length = 0;
    errorCalls.length = 0;

    const emitter = new AgentEventEmitter('test-agent', 'exec-1');
    emitter.on('output', () => {
      throw new Error('intentional test error');
    });

    await emitter.emitOutput('test');

    expect(warnCalls.length).toBe(1);
    expect(errorCalls.length).toBe(0);
    expect(warnCalls[0]!.msg).toContain('Event handler error for output');
  });

  test('catch-all ハンドラーエラーも warn レベルで記録されること', async () => {
    warnCalls.length = 0;
    errorCalls.length = 0;

    const emitter = new AgentEventEmitter('test-agent', 'exec-2');
    emitter.onAll(() => {
      throw new Error('intentional all-handler error');
    });

    await emitter.emitOutput('test');

    expect(warnCalls.length).toBe(1);
    expect(errorCalls.length).toBe(0);
    expect(warnCalls[0]!.msg).toContain('All-event handler error');
  });

  test('エラー後も他のリスナーが呼ばれること（既存テストとの整合性確認）', async () => {
    warnCalls.length = 0;

    const emitter = new AgentEventEmitter('test-agent', 'exec-3');
    let secondCalled = false;

    emitter.on('output', () => {
      throw new Error('first handler fails');
    });
    emitter.on('output', () => {
      secondCalled = true;
    });

    await emitter.emitOutput('test');

    expect(secondCalled).toBe(true);
    expect(warnCalls.length).toBe(1);
  });
});

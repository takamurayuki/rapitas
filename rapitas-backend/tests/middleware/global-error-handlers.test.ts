/**
 * global-error-handlers.test.ts
 *
 * Verifies setupGlobalErrorHandlers records unhandledRejection at error level
 * with a pino-serializable `err` key (task #507).
 * Separated from error-handler.test.ts because mock.module is process-global in
 * bun and that file exercises the real (unmocked) logger.
 */
import { describe, test, expect, mock, beforeAll, afterAll, beforeEach } from 'bun:test';

type LogArgs = [Record<string, unknown>, string];

const errorMock = mock((..._args: unknown[]) => {});
const fatalMock = mock((..._args: unknown[]) => {});
const loggerStub = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: errorMock,
  fatal: fatalMock,
};
// NOTE: full mirror of config/logger exports (createLogger / logger /
// getBackendLogFilePath) — a partial mock poisons co-executed test files.
mock.module('../../config/logger', () => ({
  createLogger: () => loggerStub,
  logger: loggerStub,
  getBackendLogFilePath: () => '',
}));

const { setupGlobalErrorHandlers } = await import('../../middleware/error-handler');

// Handlers added by setupGlobalErrorHandlers, captured for cleanup so the test
// process keeps only its own pre-existing listeners afterwards.
let addedRejectionListeners: NodeJS.UnhandledRejectionListener[] = [];
let addedExceptionListeners: NodeJS.UncaughtExceptionListener[] = [];

beforeAll(() => {
  const rejectionBefore = process.listeners('unhandledRejection');
  const exceptionBefore = process.listeners('uncaughtException');
  setupGlobalErrorHandlers();
  addedRejectionListeners = process
    .listeners('unhandledRejection')
    .filter((l) => !rejectionBefore.includes(l));
  addedExceptionListeners = process
    .listeners('uncaughtException')
    .filter((l) => !exceptionBefore.includes(l));
});

afterAll(() => {
  for (const l of addedRejectionListeners) process.removeListener('unhandledRejection', l);
  for (const l of addedExceptionListeners) process.removeListener('uncaughtException', l);
});

beforeEach(() => {
  errorMock.mockClear();
  fatalMock.mockClear();
});

describe('setupGlobalErrorHandlers - unhandledRejection', () => {
  test('registers exactly one unhandledRejection listener', () => {
    expect(addedRejectionListeners).toHaveLength(1);
  });

  test('records at error level, never fatal', () => {
    // Invoke the captured listener directly instead of process.emit so no other
    // listener in the test process reacts to a synthetic rejection.
    addedRejectionListeners[0](new Error('boom from test'), Promise.resolve());
    expect(fatalMock).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  test('payload carries the reason under the err key with message and stack', () => {
    addedRejectionListeners[0](new Error('boom from test'), Promise.resolve());
    const [payload, message] = errorMock.mock.calls[0] as LogArgs;
    // The message string is part of the log-health-check signature — must not change.
    expect(message).toBe('Unhandled Rejection');
    const err = payload.err as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom from test');
    expect(typeof err.stack).toBe('string');
    // `promise` serialized as {} and carried no information — it must be gone.
    expect(payload).not.toHaveProperty('promise');
  });
});

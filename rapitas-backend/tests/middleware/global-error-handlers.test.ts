/**
 * global-error-handlers.test.ts
 *
 * Verifies the log level and record shape of setupGlobalErrorHandlers.
 * Kept separate from error-handler.test.ts because mocking config/logger
 * via mock.module is process-global in bun and must not leak into the
 * Elysia handler tests there.
 */
import { describe, test, expect, mock, afterEach } from 'bun:test';

const errorCalls: unknown[][] = [];
const fatalCalls: unknown[][] = [];
const noop = () => {};
const captureLogger = {
  info: noop,
  warn: noop,
  debug: noop,
  error: (...args: unknown[]) => {
    errorCalls.push(args);
  },
  fatal: (...args: unknown[]) => {
    fatalCalls.push(args);
  },
};
// NOTE: full mirror of config/logger exports — bun's mock.module is
// process-global, so a partial mirror breaks unrelated test files.
mock.module('../../config/logger', () => ({
  createLogger: () => captureLogger,
  logger: captureLogger,
  getBackendLogFilePath: () => '',
}));

const { setupGlobalErrorHandlers } = await import('../../middleware/error-handler');

type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

/**
 * Registers the handlers and returns the listeners added by this call,
 * so the test can invoke them directly without emitting real process
 * events (which would also trigger bun's own listeners).
 */
function registerAndCapture(): {
  rejectionListeners: RejectionListener[];
  exceptionListeners: NodeJS.UncaughtExceptionListener[];
  cleanup: () => void;
} {
  const rejectionBefore = process.listeners('unhandledRejection');
  const exceptionBefore = process.listeners('uncaughtException');
  setupGlobalErrorHandlers();
  const rejectionListeners = process
    .listeners('unhandledRejection')
    .filter((l) => !rejectionBefore.includes(l)) as unknown as RejectionListener[];
  const exceptionListeners = process
    .listeners('uncaughtException')
    .filter((l) => !exceptionBefore.includes(l));
  const cleanup = () => {
    for (const l of rejectionListeners) {
      process.removeListener(
        'unhandledRejection',
        l as unknown as NodeJS.UnhandledRejectionListener,
      );
    }
    for (const l of exceptionListeners) {
      process.removeListener('uncaughtException', l);
    }
  };
  return { rejectionListeners, exceptionListeners, cleanup };
}

describe('setupGlobalErrorHandlers', () => {
  afterEach(() => {
    errorCalls.length = 0;
    fatalCalls.length = 0;
  });

  test('registers exactly one listener per event', () => {
    const { rejectionListeners, exceptionListeners, cleanup } = registerAndCapture();
    try {
      expect(rejectionListeners).toHaveLength(1);
      expect(exceptionListeners).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test('unhandledRejection is logged at error level, not fatal', () => {
    const { rejectionListeners, cleanup } = registerAndCapture();
    try {
      rejectionListeners[0](new Error('boom from test'), Promise.resolve());
      expect(fatalCalls).toHaveLength(0);
      expect(errorCalls).toHaveLength(1);
      expect(errorCalls[0][1]).toBe('Unhandled Rejection');
    } finally {
      cleanup();
    }
  });

  test('unhandledRejection record uses the err key and preserves message/stack', () => {
    const { rejectionListeners, cleanup } = registerAndCapture();
    try {
      const reason = new Error('rejection detail for stack check');
      rejectionListeners[0](reason, Promise.resolve());
      const payload = errorCalls[0][0] as { err?: Error; promise?: unknown };
      expect(payload.err).toBe(reason);
      expect(payload.err?.message).toBe('rejection detail for stack check');
      expect(typeof payload.err?.stack).toBe('string');
      // The old shape logged { reason, promise }, which pino serialized as {} — must be gone.
      expect(payload.promise).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

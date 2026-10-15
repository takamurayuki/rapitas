/**
 * workflow-redispatch.test
 *
 * Covers the shared one-shot delayed re-dispatch helper: after
 * REDISPATCH_DELAY_MS it must call advanceWorkflow exactly once (and not
 * before), and an advanceWorkflow rejection must be swallowed (fire-and-forget).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const advanceWorkflowMock = mock(() => Promise.resolve({ success: true }));
mock.module('./workflow-orchestrator', () => ({
  WorkflowOrchestrator: {
    getInstance: () => ({ advanceWorkflow: advanceWorkflowMock }),
  },
}));

const { scheduleWorkflowRedispatch, REDISPATCH_DELAY_MS } = await import('./workflow-redispatch');

/** Wait until the scheduled one-shot has had time to fire. */
const afterDelay = () => new Promise((resolve) => setTimeout(resolve, REDISPATCH_DELAY_MS + 100));

describe('scheduleWorkflowRedispatch', () => {
  beforeEach(() => {
    advanceWorkflowMock.mockClear();
    advanceWorkflowMock.mockImplementation(() => Promise.resolve({ success: true }));
  });

  test('calls advanceWorkflow exactly once after the delay, not before', async () => {
    scheduleWorkflowRedispatch(42, 'plan_invalid_replan', 'ja');

    // Immediately after scheduling, nothing has fired yet.
    expect(advanceWorkflowMock).not.toHaveBeenCalled();

    await afterDelay();
    expect(advanceWorkflowMock).toHaveBeenCalledTimes(1);
    expect(advanceWorkflowMock).toHaveBeenCalledWith(42, 'ja');
  });

  test('language defaults to ja when omitted (critic gate has no language)', async () => {
    scheduleWorkflowRedispatch(7, 'research_critic_failed');

    await afterDelay();
    expect(advanceWorkflowMock).toHaveBeenCalledWith(7, 'ja');
  });

  test('an advanceWorkflow rejection is swallowed (fire-and-forget)', async () => {
    advanceWorkflowMock.mockImplementation(() => Promise.reject(new Error('boom')));

    // Must not throw synchronously nor leave an unhandled rejection.
    expect(() => scheduleWorkflowRedispatch(9, 'plan_critic_failed', 'en')).not.toThrow();

    await afterDelay();
    expect(advanceWorkflowMock).toHaveBeenCalledTimes(1);
    expect(advanceWorkflowMock).toHaveBeenCalledWith(9, 'en');
  });
});

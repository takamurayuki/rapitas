/**
 * auto-run-terminal-current.test
 *
 * Regression for task 1009: a cancelled current task must be released and the
 * scheduler must advance, never re-enqueue it.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
const logCycleEventMock = mock(() => {});
mock.module('../../observability', () => ({ logCycleEvent: logCycleEventMock }));

const { isCancelledCurrent, releaseCancelledCurrent } = await import('./auto-run-terminal-current');

const updateMany = mock(() => Promise.resolve({ count: 1 }));
const prisma = { themeAutoRun: { updateMany } } as unknown as PrismaClient;

beforeEach(() => {
  updateMany.mockClear();
  logCycleEventMock.mockClear();
});

describe('isCancelledCurrent', () => {
  test('true only for cancelled non-completed tasks', () => {
    expect(isCancelledCurrent({ status: 'cancelled', workflowStatus: null })).toBe(true);
    expect(isCancelledCurrent({ status: 'done', workflowStatus: 'completed' })).toBe(false);
    expect(isCancelledCurrent({ status: 'in-progress', workflowStatus: null })).toBe(false);
    expect(isCancelledCurrent(null)).toBe(false);
  });
});

describe('releaseCancelledCurrent', () => {
  test('CAS-releases currentTaskId and logs terminal_current_released', async () => {
    await releaseCancelledCurrent(prisma, 1, 1008);
    expect(updateMany).toHaveBeenCalledWith({
      where: { currentTaskId: 1008 },
      data: { currentTaskId: null },
    });
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'task.skipped',
      expect.objectContaining({ cause: 'terminal_current_released', task: 1008 }),
    );
  });
});

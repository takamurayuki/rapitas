/**
 * restart-wait-policy.test
 *
 * Pure-function coverage for the restart-wait start decision (task 1562): the
 * 30 min origin, the 60 min restart floor, the schema-change shortcut (both
 * schema directories), and the queue depth the restart gates read.
 */
import { describe, test, expect } from 'bun:test';
import {
  RESTART_WAIT_AFTER_MS,
  decideRestartWaitStart,
  isSnapshotBusy,
  restartQueueDepth,
  touchesPrismaSchema,
} from './boundary-policy';

describe('decideRestartWaitStart', () => {
  const MIN = 3_600_000;
  const now = 10_000_000_000;
  const base = {
    aheadCount: 2,
    aheadSinceAt: now - RESTART_WAIT_AFTER_MS,
    now,
    msSinceLastRestart: null as number | null,
    minRestartIntervalMs: MIN,
    changedPaths: ['rapitas-frontend/src/a.tsx'],
  };

  test('nothing waiting → does nothing', () => {
    expect(decideRestartWaitStart({ ...base, aheadCount: 0 })).toEqual({
      start: false,
      reason: 'nothing-ahead',
    });
  });

  test('exactly 30 min of waiting enters the wait; 1 ms less does not', () => {
    expect(decideRestartWaitStart(base)).toEqual({ start: true, reason: 'ahead-too-long' });
    expect(decideRestartWaitStart({ ...base, aheadSinceAt: base.aheadSinceAt + 1 }).start).toBe(
      false,
    );
  });

  test('an unobserved start time never enters the wait', () => {
    expect(decideRestartWaitStart({ ...base, aheadSinceAt: null }).start).toBe(false);
  });

  test('a schema change enters the wait without the 30 min', () => {
    const young = { ...base, aheadSinceAt: now - 1000 };
    expect(
      decideRestartWaitStart({ ...young, changedPaths: ['prisma/schema/task.prisma'] }),
    ).toEqual({ start: true, reason: 'schema-change' });
    expect(
      decideRestartWaitStart({ ...young, changedPaths: ['prisma/schema.desktop/task.prisma'] }),
    ).toEqual({ start: true, reason: 'schema-change' });
  });

  test('the 60 min restart floor holds the wait back, schema change included', () => {
    const recent = { ...base, msSinceLastRestart: MIN - 1 };
    expect(decideRestartWaitStart(recent).reason).toBe('rate-limited');
    expect(
      decideRestartWaitStart({ ...recent, changedPaths: ['prisma/schema/a.prisma'] }).start,
    ).toBe(false);
    expect(decideRestartWaitStart({ ...base, msSinceLastRestart: MIN }).start).toBe(true);
  });
});

describe('touchesPrismaSchema', () => {
  test('matches both schema directories, with Windows separators and ./', () => {
    expect(touchesPrismaSchema(['prisma/schema/a.prisma'])).toBe(true);
    expect(touchesPrismaSchema(['prisma/schema.desktop/a.prisma'])).toBe(true);
    // git diff --name-only reports repo-root paths.
    expect(touchesPrismaSchema(['rapitas-backend/prisma/schema/a.prisma'])).toBe(true);
    expect(touchesPrismaSchema(['rapitas-backend/prisma/schema.desktop/a.prisma'])).toBe(true);
    expect(touchesPrismaSchema(['.\\prisma\\schema\\a.prisma'])).toBe(true);
  });

  test('does not match look-alikes, empty or missing input', () => {
    expect(touchesPrismaSchema(['prisma/schema.prisma'])).toBe(false);
    expect(touchesPrismaSchema(['rapitas-backend/xprisma/schema/a.prisma'])).toBe(false);
    expect(touchesPrismaSchema(['prisma/migrations/1/migration.sql'])).toBe(false);
    expect(touchesPrismaSchema([])).toBe(false);
    expect(touchesPrismaSchema(null)).toBe(false);
  });
});

describe('restartQueueDepth / isSnapshotBusy', () => {
  const quiet = {
    activeExecutionsDegraded: false,
    isShuttingDown: false,
    activeExecutions: 0,
    runningExecutions: 0,
    queueDepth: 3,
  };

  test('reads dispatchableQueueDepth, falling back to queueDepth when absent', () => {
    expect(restartQueueDepth({ queueDepth: 3, dispatchableQueueDepth: 0 })).toBe(0);
    expect(restartQueueDepth({ queueDepth: 3 })).toBe(3);
  });

  test('queued items of a paused theme do not make the system busy', () => {
    expect(isSnapshotBusy({ ...quiet, dispatchableQueueDepth: 0 })).toBe(false);
    expect(isSnapshotBusy({ ...quiet, dispatchableQueueDepth: 1 })).toBe(true);
    expect(isSnapshotBusy(quiet)).toBe(true);
    expect(isSnapshotBusy({ ...quiet, dispatchableQueueDepth: 0, activeExecutions: 1 })).toBe(true);
    expect(
      isSnapshotBusy({ ...quiet, dispatchableQueueDepth: 0, activeExecutionsDegraded: true }),
    ).toBe(true);
  });
});

/**
 * auto-run-lifecycle — stopped-theme re-arm tests (#952)
 *
 * Decision recorded in #952 (option 1): an urgent/high concern re-arms a theme
 * the IDLE TIMER stopped, as it already could one minute earlier while the
 * timer was counting. A theme the USER stopped stays stopped.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = () => {};
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
}));
mock.module('../../task/task-resolver', () => ({ resolveTaskWorkingDirectory: async () => null }));
mock.module('../../agents/agent-worker-manager', () => ({
  AgentWorkerManager: { getInstance: () => ({}) },
}));
mock.module('../../communication/realtime-service', () => ({
  realtimeService: { broadcast: noop, sendToChannel: noop },
}));
const promoteBacklogForTheme = mock(async () => 0);
mock.module('./backlog-task-promoter', () => ({
  hasPromotableBacklog: async () => false,
  promoteBacklogForTheme,
}));
mock.module('../../observability', () => ({ logCycleEvent: noop }));
mock.module('./auto-run-selection', () => ({
  getThemeActiveQueueItems: async () => [],
  hasItemAwaitingApproval: async () => false,
}));
mock.module('../plan-approval-queue-sync', () => ({
  isTaskPlanApproved: async () => false,
  syncQueueAfterPlanApproval: async () => undefined,
}));
mock.module('./approval-pause-release', () => ({
  decideApprovalPauseRelease: () => ({ release: false }),
  releaseApprovalPause: async () => undefined,
  resolveApprovalPauseFacts: async () => ({}),
}));
const startAutoRun = mock(async (_themeId: number) => undefined);
mock.module('./theme-auto-run-service', () => ({
  resumeAutoRun: async () => undefined,
  finalizeStop: async () => undefined,
  startAutoRun,
  isAutoResumablePauseStatus: () => false,
}));
let concernAvailable = false;
const attemptCriticalConcernBypass = mock(async (_themeId: number) => concernAvailable);
mock.module('./auto-run-idle-timer', () => ({
  getIdleStopMinutes: async () => 60,
  isIdleTimerActivelyCounting: () => false,
  isIdleTimerExpired: () => false,
  countHumanOriginTodo: async () => 0,
  attemptCriticalConcernBypass,
  stopThemeForIdleTimeout: async () => undefined,
  shouldRefillBacklogNow: async () => false,
  markSelfRefillSucceeded: async () => undefined,
}));

const { processIdleThemesImpl } = await import('./auto-run-lifecycle');

const prisma = { task: { count: async () => 0 } } as never;
const stopped = (idleStoppedAt: Date | null) =>
  ({
    themeId: 7,
    enabled: false,
    status: 'idle',
    idleSince: new Date('2026-11-01T00:00:00Z'),
    idleStoppedAt,
  }) as never;

beforeEach(() => {
  concernAvailable = false;
  startAutoRun.mockClear();
  attemptCriticalConcernBypass.mockClear();
  promoteBacklogForTheme.mockClear();
});

describe('processIdleThemesImpl — stopped themes (#952)', () => {
  test('an urgent/high concern re-arms a TIMER-stopped theme', async () => {
    concernAvailable = true;
    await processIdleThemesImpl(prisma, [stopped(new Date('2026-11-01T01:00:00Z'))]);
    expect(attemptCriticalConcernBypass).toHaveBeenCalledWith(7);
    expect(startAutoRun).toHaveBeenCalledWith(7);
  });

  test('a USER-stopped theme stays stopped even with an urgent concern open', async () => {
    concernAvailable = true;
    await processIdleThemesImpl(prisma, [stopped(null)]);
    expect(attemptCriticalConcernBypass).not.toHaveBeenCalled();
    expect(startAutoRun).not.toHaveBeenCalled();
  });

  test('with no concern to promote, a timer-stopped theme stays stopped', async () => {
    await processIdleThemesImpl(prisma, [stopped(new Date('2026-11-01T01:00:00Z'))]);
    expect(startAutoRun).not.toHaveBeenCalled();
  });
});

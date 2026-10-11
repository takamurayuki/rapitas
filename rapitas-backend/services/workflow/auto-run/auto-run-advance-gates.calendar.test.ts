/**
 * auto-run-advance-gates.calendar.test
 *
 * checkCalendarSlotGate (task 1174): AC2 (no selection outside free time),
 * AC3 (hold from start - lead), AC4 (release exactly at the meeting end and
 * log the resume), env-unset legacy pass-through, fail-open on error/stale,
 * and the one-shot manual override.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const logCycleEventMock = mock(() => {});
mock.module('../../observability', () => ({ logCycleEvent: logCycleEventMock }));
mock.module('../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ getMaxConcurrency: () => 1 }) },
  isTaskTerminalForQueue: () => false,
}));
mock.module('./auto-run-notifications', () => ({
  notifyResourceContentionHold: mock(async () => {}),
}));
mock.module('../../system/resource-telemetry', () => ({
  getHostCpuBusyPercent: () => null,
}));

const { checkCalendarSlotGate } = await import('./auto-run-advance-gates');
const {
  resetCalendarHoldState,
  updateCalendarSnapshot,
  isCalendarHoldActive,
  requestCalendarGateOverride,
} = await import('../../scheduling/calendar-slot/calendar-hold-state');

const at = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00.000Z`);
const MEETING = { startAt: at('10:00'), endAt: at('11:00') };

function makePrisma() {
  const create = mock(async (_args: { data: { action: string; metadata: string } }) => ({}));
  return { prisma: { activityLog: { create } } as never, create };
}

function actions(create: ReturnType<typeof makePrisma>['create']): string[] {
  return create.mock.calls.map((c) => (c[0] as { data: { action: string } }).data.action);
}

describe('checkCalendarSlotGate', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    resetCalendarHoldState();
    logCycleEventMock.mockClear();
    process.env.RAPITAS_CALENDAR_GATE_ENABLED = 'true';
    process.env.RAPITAS_CALENDAR_LEAD_MINUTES = '10';
    process.env.RAPITAS_CALENDAR_POLL_MINUTES = '5';
    updateCalendarSnapshot({
      busyBlocks: [MEETING],
      lastSyncedAt: at('09:45'),
      lastStatus: 'ok',
      lastError: null,
    });
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('always passes when RAPITAS_CALENDAR_GATE_ENABLED is unset (legacy behaviour)', async () => {
    delete process.env.RAPITAS_CALENDAR_GATE_ENABLED;
    const { prisma, create } = makePrisma();
    expect(await checkCalendarSlotGate(prisma, 1, at('10:30'))).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('passes in a free slot', async () => {
    const { prisma } = makePrisma();
    expect(await checkCalendarSlotGate(prisma, 1, at('09:45'))).toBe(false);
  });

  it('holds from start - lead and logs the hold start once', async () => {
    const { prisma, create } = makePrisma();
    expect(await checkCalendarSlotGate(prisma, 1, at('09:50'))).toBe(true);
    expect(await checkCalendarSlotGate(prisma, 1, at('09:52'))).toBe(true);
    expect(actions(create)).toEqual(['calendar_slot.hold_started']);
    const meta = JSON.parse(
      (create.mock.calls[0]![0] as { data: { metadata: string } }).data.metadata,
    );
    expect(meta).toMatchObject({
      themeId: 1,
      reason: 'pre_meeting',
      releaseAt: at('11:00').toISOString(),
    });
    expect(logCycleEventMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      'task.calendar_hold',
    ]);
    expect(isCalendarHoldActive(1, at('09:52'))).toBe(true);
  });

  it('releases exactly at the meeting end and logs the resume', async () => {
    const { prisma, create } = makePrisma();
    updateCalendarSnapshot({ lastSyncedAt: at('10:55') });
    expect(await checkCalendarSlotGate(prisma, 1, at('10:59'))).toBe(true);
    expect(await checkCalendarSlotGate(prisma, 1, at('11:00'))).toBe(false);
    expect(actions(create)).toEqual(['calendar_slot.hold_started', 'calendar_slot.hold_released']);
    expect(isCalendarHoldActive(1, at('11:00'))).toBe(false);
  });

  it('fails open when the last sync errored', async () => {
    updateCalendarSnapshot({ lastStatus: 'error', lastError: 'invalid_grant' });
    const { prisma } = makePrisma();
    expect(await checkCalendarSlotGate(prisma, 1, at('10:30'))).toBe(false);
  });

  it('fails open when the snapshot is stale (> 3 poll intervals)', async () => {
    const { prisma } = makePrisma();
    expect(await checkCalendarSlotGate(prisma, 1, at('10:01'))).toBe(false);
  });

  it('bypasses exactly one cycle after a manual override', async () => {
    updateCalendarSnapshot({ lastSyncedAt: at('10:25') });
    const { prisma } = makePrisma();
    requestCalendarGateOverride(1);
    expect(await checkCalendarSlotGate(prisma, 1, at('10:30'))).toBe(false);
    expect(await checkCalendarSlotGate(prisma, 1, at('10:30'))).toBe(true);
  });
});

/**
 * workflow-orchestrator-calendar-guard.test
 *
 * AC3/AC4 (task 1174): a task already running under the queue runner stops at
 * the next phase boundary (the checkpoint) from `start - lead` until the
 * meeting ends, then continues from its saved workflowStatus. Fails open when
 * the gate is off, the calendar is unusable, or the call is not runner-owned.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const logCycleEventMock = mock(() => {});
mock.module('../observability', () => ({ logCycleEvent: logCycleEventMock }));

const { guardCalendarPhaseBoundary } = await import('./workflow-orchestrator-calendar-guard');
const { resetCalendarHoldState, updateCalendarSnapshot, isTaskCalendarHeld } =
  await import('../scheduling/calendar-slot/calendar-hold-state');

const at = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00.000Z`);
const MEETING = { startAt: at('10:00'), endAt: at('11:00') };
const TRANSITION = { role: 'implementer', nextStatus: 'in_progress' } as never;

function makeDeps(now: Date, runnerOwned = true) {
  const recordActivity = mock(async (_a: string, _m: Record<string, unknown>) => {});
  return {
    deps: {
      now: () => now,
      runnerOwned: async () => runnerOwned,
      recordActivity,
    },
    recordActivity,
  };
}

describe('guardCalendarPhaseBoundary', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    resetCalendarHoldState();
    logCycleEventMock.mockClear();
    process.env.RAPITAS_CALENDAR_GATE_ENABLED = 'true';
    process.env.RAPITAS_CALENDAR_LEAD_MINUTES = '10';
    process.env.RAPITAS_CALENDAR_POLL_MINUTES = '5';
    updateCalendarSnapshot({
      busyBlocks: [MEETING],
      lastSyncedAt: at('09:48'),
      lastStatus: 'ok',
      lastError: null,
    });
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('continues to the next phase in free time', async () => {
    const { deps } = makeDeps(at('09:45'));
    const r = await guardCalendarPhaseBoundary(7, TRANSITION, 'plan_approved', deps);
    expect(r.done).toBe(false);
  });

  it('stops at the phase boundary from start - lead and re-queues (skipped + held)', async () => {
    const { deps, recordActivity } = makeDeps(at('09:50'));
    const r = await guardCalendarPhaseBoundary(7, TRANSITION, 'plan_approved', deps);
    expect(r.done).toBe(true);
    if (!r.done) throw new Error('unreachable');
    expect(r.result).toMatchObject({
      success: true,
      skipped: true,
      role: 'implementer',
      status: 'plan_approved',
    });
    expect(r.result.held).toContain('calendar');
    expect(isTaskCalendarHeld(7, at('09:50'))).toBe(true);
    expect(recordActivity.mock.calls.map((c) => c[0])).toEqual(['calendar_slot.phase_held']);
    expect(recordActivity.mock.calls[0]![1]).toMatchObject({
      taskId: 7,
      checkpoint: 'plan_approved',
      releaseAt: at('11:00').toISOString(),
    });

    // A second re-check during the hold (fresh sync) does not log again.
    updateCalendarSnapshot({ lastSyncedAt: at('10:25') });
    const again = await guardCalendarPhaseBoundary(
      7,
      TRANSITION,
      'plan_approved',
      makeDeps(at('10:30')).deps,
    );
    expect(again.done).toBe(true);
    expect(recordActivity.mock.calls.length).toBe(1);
  });

  it('resumes from the saved checkpoint exactly at the meeting end', async () => {
    updateCalendarSnapshot({ lastSyncedAt: at('10:55') });
    const held = await guardCalendarPhaseBoundary(
      7,
      TRANSITION,
      'plan_approved',
      makeDeps(at('10:59')).deps,
    );
    expect(held.done).toBe(true);
    updateCalendarSnapshot({ lastSyncedAt: at('10:58') });
    const { deps, recordActivity } = makeDeps(at('11:00'));
    const r = await guardCalendarPhaseBoundary(7, TRANSITION, 'plan_approved', deps);
    expect(r.done).toBe(false);
    expect(isTaskCalendarHeld(7, at('11:00'))).toBe(false);
    expect(recordActivity.mock.calls.map((c) => c[0])).toEqual(['calendar_slot.phase_released']);
    expect(recordActivity.mock.calls[0]![1]).toMatchObject({
      taskId: 7,
      checkpoint: 'plan_approved',
    });
  });

  it('never holds when the gate is disabled (env unset)', async () => {
    delete process.env.RAPITAS_CALENDAR_GATE_ENABLED;
    const r = await guardCalendarPhaseBoundary(
      7,
      TRANSITION,
      'plan_approved',
      makeDeps(at('10:30')).deps,
    );
    expect(r.done).toBe(false);
  });

  it('fails open when the last sync errored', async () => {
    updateCalendarSnapshot({ lastStatus: 'error', lastError: 'invalid_grant' });
    const r = await guardCalendarPhaseBoundary(
      7,
      TRANSITION,
      'plan_approved',
      makeDeps(at('09:55')).deps,
    );
    expect(r.done).toBe(false);
  });

  it('does not hold a call that is not owned by the queue runner (nothing would resume it)', async () => {
    const r = await guardCalendarPhaseBoundary(
      7,
      TRANSITION,
      'plan_approved',
      makeDeps(at('09:55'), false).deps,
    );
    expect(r.done).toBe(false);
  });

  it('fails open when the runner-ownership lookup throws', async () => {
    const r = await guardCalendarPhaseBoundary(7, TRANSITION, 'plan_approved', {
      now: () => at('09:55'),
      runnerOwned: async () => {
        throw new Error('db down');
      },
      recordActivity: async () => {},
    });
    expect(r.done).toBe(false);
  });
});

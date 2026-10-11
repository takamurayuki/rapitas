/**
 * free-slot.test
 *
 * Boundary tests for the calendar free-slot arithmetic and the hold decision
 * (task 1174, AC2/AC3/AC4): merge, complement, lead-minute hold start, and
 * release exactly at the meeting end.
 */
import { describe, it, expect } from 'bun:test';
import {
  mergeBusyBlocks,
  computeFreeSlots,
  evaluateCalendarGate,
  computeNextRunAt,
  isSyncStale,
} from './free-slot';

const at = (hhmm: string, day = '2026-10-12') => new Date(`${day}T${hhmm}:00.000Z`);
const block = (s: string, e: string, day = '2026-10-12') => ({
  startAt: at(s, day),
  endAt: at(e, day),
});

describe('mergeBusyBlocks', () => {
  it('returns an empty list when there are no blocks', () => {
    expect(mergeBusyBlocks([])).toEqual([]);
  });

  it('merges overlapping and back-to-back blocks and sorts them', () => {
    const merged = mergeBusyBlocks([
      block('13:00', '14:00'),
      block('10:00', '11:00'),
      block('10:30', '11:30'),
      block('11:30', '12:00'),
    ]);
    expect(merged).toEqual([block('10:00', '12:00'), block('13:00', '14:00')]);
  });

  it('drops zero- and negative-length blocks', () => {
    expect(mergeBusyBlocks([block('10:00', '10:00'), block('11:00', '10:00')])).toEqual([]);
  });
});

describe('computeFreeSlots', () => {
  it('returns the whole range when there are no meetings', () => {
    expect(computeFreeSlots([], at('09:00'), at('18:00'), 10)).toEqual([
      { startAt: at('09:00'), endAt: at('18:00') },
    ]);
  });

  it('removes each meeting plus its lead window from the range', () => {
    const slots = computeFreeSlots([block('10:00', '11:00')], at('09:00'), at('12:00'), 10);
    expect(slots).toEqual([
      { startAt: at('09:00'), endAt: at('09:50') },
      { startAt: at('11:00'), endAt: at('12:00') },
    ]);
  });

  it('omits a gap that the lead window fully consumes (no zero-length slot)', () => {
    const slots = computeFreeSlots(
      [block('10:00', '11:00'), block('11:05', '12:00')],
      at('09:00'),
      at('13:00'),
      10,
    );
    expect(slots).toEqual([
      { startAt: at('09:00'), endAt: at('09:50') },
      { startAt: at('12:00'), endAt: at('13:00') },
    ]);
  });

  it('handles a meeting that crosses midnight', () => {
    const overnight = { startAt: at('23:00', '2026-10-12'), endAt: at('01:00', '2026-10-13') };
    const slots = computeFreeSlots(
      [overnight],
      at('22:00', '2026-10-12'),
      at('02:00', '2026-10-13'),
      0,
    );
    expect(slots).toEqual([
      { startAt: at('22:00', '2026-10-12'), endAt: at('23:00', '2026-10-12') },
      { startAt: at('01:00', '2026-10-13'), endAt: at('02:00', '2026-10-13') },
    ]);
  });
});

describe('evaluateCalendarGate', () => {
  const busy = [block('10:00', '11:00')];
  const base = { busyBlocks: busy, leadMinutes: 10, enabled: true, overridden: false };

  it('never holds when the gate is disabled (env unset = legacy behaviour)', () => {
    const r = evaluateCalendarGate({ ...base, enabled: false, now: at('10:30') });
    expect(r.hold).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('passes in a free slot well before the meeting', () => {
    const r = evaluateCalendarGate({ ...base, now: at('09:48') });
    expect(r.hold).toBe(false);
    expect(r.reason).toBe('free');
  });

  it('passes one minute before the lead window opens', () => {
    expect(evaluateCalendarGate({ ...base, now: at('09:49') }).hold).toBe(false);
  });

  it('holds exactly at start - lead (pre-meeting checkpoint)', () => {
    const r = evaluateCalendarGate({ ...base, now: at('09:50') });
    expect(r.hold).toBe(true);
    expect(r.reason).toBe('pre_meeting');
    expect(r.releaseAt).toEqual(at('11:00'));
    expect(r.blockStartAt).toEqual(at('10:00'));
  });

  it('holds during the meeting', () => {
    const r = evaluateCalendarGate({ ...base, now: at('10:59') });
    expect(r.hold).toBe(true);
    expect(r.reason).toBe('in_meeting');
  });

  it('releases exactly at the meeting end (resume from the saved phase)', () => {
    const r = evaluateCalendarGate({ ...base, now: at('11:00') });
    expect(r.hold).toBe(false);
    expect(r.reason).toBe('free');
  });

  it('extends the release past a follow-up meeting whose lead window starts before the first ends', () => {
    const r = evaluateCalendarGate({
      ...base,
      busyBlocks: [block('10:00', '11:00'), block('11:05', '12:00')],
      now: at('10:30'),
    });
    expect(r.hold).toBe(true);
    expect(r.releaseAt).toEqual(at('12:00'));
  });

  it('does not hold when leadMinutes=0 and the meeting has not started', () => {
    const r = evaluateCalendarGate({ ...base, leadMinutes: 0, now: at('09:59') });
    expect(r.hold).toBe(false);
  });

  it('does not hold when a manual override was consumed', () => {
    const r = evaluateCalendarGate({ ...base, overridden: true, now: at('10:30') });
    expect(r.hold).toBe(false);
    expect(r.reason).toBe('overridden');
  });
});

describe('computeNextRunAt', () => {
  const busy = [block('10:00', '11:00')];

  it('returns now when the current moment is free', () => {
    expect(computeNextRunAt({ now: at('09:00'), busyBlocks: busy, leadMinutes: 10 })).toEqual(
      at('09:00'),
    );
  });

  it('returns the meeting end when currently held', () => {
    expect(computeNextRunAt({ now: at('09:55'), busyBlocks: busy, leadMinutes: 10 })).toEqual(
      at('11:00'),
    );
  });

  it('returns null when no free time exists before the horizon', () => {
    expect(
      computeNextRunAt({
        now: at('10:15'),
        busyBlocks: busy,
        leadMinutes: 10,
        horizon: at('10:45'),
      }),
    ).toBeNull();
  });
});

describe('isSyncStale', () => {
  it('treats a never-synced state as stale', () => {
    expect(isSyncStale(null, at('10:00'), 5)).toBe(true);
  });

  it('is fresh up to three poll intervals and stale beyond', () => {
    expect(isSyncStale(at('10:00'), at('10:15'), 5)).toBe(false);
    expect(isSyncStale(at('10:00'), at('10:16'), 5)).toBe(true);
  });
});

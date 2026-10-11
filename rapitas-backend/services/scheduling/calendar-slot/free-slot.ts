/**
 * free-slot
 *
 * Pure time arithmetic for the calendar-aware auto-run gate (task 1174):
 * merging busy blocks, deriving free slots, and deciding whether next-task
 * selection must be held because a meeting is about to start or in progress.
 * Not responsible for fetching calendar data (freebusy-client.ts) or for any
 * side effect such as logging a hold (auto-run-advance-gates.ts).
 */

/** One busy interval from Google FreeBusy. Holds times only — never a title or attendee. */
export interface BusyBlock {
  startAt: Date;
  endAt: Date;
}

/** One interval during which auto-run may start new work. */
export interface FreeSlot {
  startAt: Date;
  endAt: Date;
}

const MINUTE_MS = 60_000;

/**
 * Sort busy blocks and merge overlapping or back-to-back ones; drops blocks
 * whose length is zero or negative.
 *
 * @param blocks - Raw busy blocks in any order / 未整列の予定区間
 * @returns Sorted, non-overlapping blocks / 整列・結合済みの予定区間
 */
export function mergeBusyBlocks(blocks: readonly BusyBlock[]): BusyBlock[] {
  const valid = blocks
    .filter((b) => b.endAt.getTime() > b.startAt.getTime())
    .map((b) => ({ startAt: new Date(b.startAt), endAt: new Date(b.endAt) }))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const merged: BusyBlock[] = [];
  for (const b of valid) {
    const last = merged[merged.length - 1];
    if (last && b.startAt.getTime() <= last.endAt.getTime()) {
      if (b.endAt.getTime() > last.endAt.getTime()) last.endAt = b.endAt;
    } else {
      merged.push(b);
    }
  }
  return merged;
}

/**
 * Widen each block by the lead window and merge again, so a gap shorter than
 * `leadMinutes` between two meetings collapses into one hold interval.
 */
function holdIntervals(blocks: readonly BusyBlock[], leadMinutes: number): BusyBlock[] {
  const leadMs = Math.max(0, leadMinutes) * MINUTE_MS;
  return mergeBusyBlocks(
    mergeBusyBlocks(blocks).map((b) => ({
      startAt: new Date(b.startAt.getTime() - leadMs),
      endAt: b.endAt,
    })),
  );
}

/**
 * Free slots inside [rangeStart, rangeEnd): the complement of every meeting
 * widened by its lead window. Slots of length 0 or less are omitted.
 *
 * @param blocks - Busy blocks / 予定区間
 * @param rangeStart - Range start / 範囲の開始
 * @param rangeEnd - Range end / 範囲の終了
 * @param leadMinutes - Minutes before a meeting during which new work is held / 会議前の保留分数
 * @returns Free slots in chronological order / 空き枠（時系列順）
 */
export function computeFreeSlots(
  blocks: readonly BusyBlock[],
  rangeStart: Date,
  rangeEnd: Date,
  leadMinutes: number,
): FreeSlot[] {
  const slots: FreeSlot[] = [];
  let cursor = rangeStart.getTime();
  const end = rangeEnd.getTime();
  for (const h of holdIntervals(blocks, leadMinutes)) {
    const hs = h.startAt.getTime();
    const he = h.endAt.getTime();
    if (he <= cursor) continue;
    if (hs >= end) break;
    if (hs > cursor) slots.push({ startAt: new Date(cursor), endAt: new Date(hs) });
    cursor = Math.max(cursor, he);
  }
  if (end > cursor) slots.push({ startAt: new Date(cursor), endAt: new Date(end) });
  return slots;
}

export interface CalendarGateInput {
  /** Current time. / 現在時刻 */
  now: Date;
  /** Busy blocks from the last successful sync. / 直近同期の予定区間 */
  busyBlocks: readonly BusyBlock[];
  /** RAPITAS_CALENDAR_LEAD_MINUTES. / 会議前の保留分数 */
  leadMinutes: number;
  /** RAPITAS_CALENDAR_GATE_ENABLED=true. / ゲート有効フラグ */
  enabled: boolean;
  /** Whether a one-shot manual override was consumed. / 手動オーバーライド消費済みか */
  overridden: boolean;
}

export type CalendarGateReason = 'disabled' | 'overridden' | 'free' | 'pre_meeting' | 'in_meeting';

export interface CalendarGateResult {
  hold: boolean;
  reason: CalendarGateReason;
  /** When the hold lifts (end of the merged meeting chain), or null when not held. */
  releaseAt: Date | null;
  /** Start of the meeting that caused the hold, or null when not held. */
  blockStartAt: Date | null;
}

/**
 * Decide whether next-task selection must be held. Holds from
 * `start - leadMinutes` (inclusive) until `end` (exclusive): at exactly the
 * meeting end the hold lifts and selection resumes.
 *
 * @param input - Clock, busy blocks and gate settings / 判定入力
 * @returns Hold decision with reason and release time / 保留判定と理由・解除時刻
 */
export function evaluateCalendarGate(input: CalendarGateInput): CalendarGateResult {
  const free: CalendarGateResult = {
    hold: false,
    reason: 'free',
    releaseAt: null,
    blockStartAt: null,
  };
  if (!input.enabled) return { ...free, reason: 'disabled' };
  if (input.overridden) return { ...free, reason: 'overridden' };
  const now = input.now.getTime();
  const leadMs = Math.max(0, input.leadMinutes) * MINUTE_MS;
  const meetings = mergeBusyBlocks(input.busyBlocks);
  const hold = holdIntervals(meetings, input.leadMinutes).find(
    (h) => now >= h.startAt.getTime() && now < h.endAt.getTime(),
  );
  if (!hold) return free;
  // The meeting that opened this hold interval is the first one whose lead
  // window starts at the interval start.
  const first =
    meetings.find((m) => m.startAt.getTime() - leadMs === hold.startAt.getTime()) ?? meetings[0];
  const inMeeting = meetings.some((m) => now >= m.startAt.getTime() && now < m.endAt.getTime());
  return {
    hold: true,
    reason: inMeeting ? 'in_meeting' : 'pre_meeting',
    releaseAt: hold.endAt,
    blockStartAt: first?.startAt ?? null,
  };
}

/**
 * The earliest time at or after `now` when the gate would let new work start.
 *
 * @param args.now - Current time / 現在時刻
 * @param args.busyBlocks - Busy blocks / 予定区間
 * @param args.leadMinutes - Lead window in minutes / 会議前の保留分数
 * @param args.horizon - Optional end of known calendar data / 予定取得範囲の終端
 * @returns Next run time, or null when nothing is free before the horizon / 次回実行可能時刻（無ければ null）
 */
export function computeNextRunAt(args: {
  now: Date;
  busyBlocks: readonly BusyBlock[];
  leadMinutes: number;
  horizon?: Date;
}): Date | null {
  const gate = evaluateCalendarGate({
    now: args.now,
    busyBlocks: args.busyBlocks,
    leadMinutes: args.leadMinutes,
    enabled: true,
    overridden: false,
  });
  const next = gate.hold && gate.releaseAt ? gate.releaseAt : args.now;
  if (args.horizon && next.getTime() >= args.horizon.getTime()) return null;
  return next;
}

/**
 * Whether the last successful sync is too old to trust (more than three poll
 * intervals). A stale snapshot makes the gate fail open.
 *
 * @param lastSyncedAt - Last successful sync, or null / 最終同期時刻
 * @param now - Current time / 現在時刻
 * @param pollMinutes - Poll interval in minutes / ポーリング間隔(分)
 * @returns true when the snapshot must not be used / 古くて使えない場合 true
 */
export function isSyncStale(lastSyncedAt: Date | null, now: Date, pollMinutes: number): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() > 3 * pollMinutes * MINUTE_MS;
}

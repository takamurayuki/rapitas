/**
 * calendar-hold-decision
 *
 * The one hold decision shared by the auto-run selection gate and the
 * phase-boundary guard (task 1174): read the stored busy blocks and poller
 * status through calendar-store, judge usability (gate on, last sync ok and
 * fresh), then evaluate the pure gate. Not responsible for any side effect
 * (logging a hold, marking themes/tasks).
 */
import { evaluateCalendarGate, isSyncStale, type CalendarGateResult } from './free-slot';
import { getCalendarSlotSettings } from './calendar-hold-state';
import { getSyncState, listBusyBlocks } from './calendar-store';

export interface CalendarHoldDecision {
  /** false → the gate fails open (disabled, sync errored/never ran, or stale). */
  usable: boolean;
  gate: CalendarGateResult;
}

/**
 * Decide the calendar hold for `now`.
 *
 * @param now - Current time / 現在時刻
 * @param consumeOverride - Consumes a one-shot override; called only when the data is usable / 手動オーバーライドの消費
 * @returns Usability and the gate decision / 有効性と保留判定
 */
export async function decideCalendarHold(
  now: Date,
  consumeOverride: () => boolean = () => false,
): Promise<CalendarHoldDecision> {
  const settings = getCalendarSlotSettings();
  if (!settings.enabled) {
    return {
      usable: false,
      gate: { hold: false, reason: 'disabled', releaseAt: null, blockStartAt: null },
    };
  }
  const state = await getSyncState();
  const usable =
    state?.lastStatus === 'ok' && !isSyncStale(state.lastSyncedAt, now, settings.pollMinutes);
  const gate = evaluateCalendarGate({
    now,
    busyBlocks: usable ? await listBusyBlocks() : [],
    leadMinutes: settings.leadMinutes,
    enabled: usable,
    overridden: usable && consumeOverride(),
  });
  return { usable, gate };
}

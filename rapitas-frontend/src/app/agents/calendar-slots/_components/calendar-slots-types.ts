/**
 * calendar-slots-types
 *
 * Response shapes of the backend /calendar-slots API (task 1174). Busy
 * blocks carry times only — no event title or attendee is ever returned.
 */

/** A time interval as ISO strings. */
export interface SlotInterval {
  startAt: string;
  endAt: string;
}

/** GET /calendar-slots/next-runs */
export interface NextRunsResponse {
  enabled: boolean;
  leadMinutes: number;
  nextRunAt: string | null;
  gate: { hold: boolean; reason: string; releaseAt: string | null };
  freeSlots: SlotInterval[];
  busyBlocks: SlotInterval[];
  holds: Array<{ themeId: number; releaseAt: string | null }>;
}

/** GET /calendar-slots/sync-state */
export interface SyncStateResponse {
  enabled: boolean;
  connected: boolean;
  pollMinutes: number;
  lastSyncedAt: string | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastError: string | null;
  stale: boolean;
}

/** One calendar_slot.* ActivityLog row. */
export interface SlotLogItem {
  id: number;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** GET /calendar-slots/logs */
export interface SlotLogsResponse {
  total: number;
  items: SlotLogItem[];
}

/**
 * TimelineFake
 *
 * In-memory stand-in for services/memory/timeline used by supervision tests. It
 * mirrors the real append/query semantics (JSON round-trip, filters, newest-first
 * ordering, limit, total) so tests exercise the detectors' actual logic instead of
 * canned return values. Test-only; never imported by production code.
 */

export interface FakeTimelineRow {
  id: number;
  eventType: string;
  actorType: string;
  actorId: string | null;
  payload: string;
  correlationId: string | null;
  createdAt: Date;
}

export interface TimelineFake {
  rows: FakeTimelineRow[];
  /** Clock used for createdAt of appended rows. */
  now: () => Date;
  setNow: (d: Date) => void;
  /** When > 0, the next N appends (optionally of one eventType) throw. */
  failNextAppends: (count: number, eventType?: string) => void;
  seed: (row: {
    eventType: string;
    payload: Record<string, unknown>;
    correlationId?: string;
    createdAt: Date;
  }) => void;
  module: {
    appendEvent: (event: {
      eventType: string;
      actorType?: string;
      actorId?: string;
      payload?: Record<string, unknown>;
      correlationId?: string;
    }) => Promise<{ id: number }>;
    queryEvents: (options?: {
      eventType?: string;
      actorType?: string;
      correlationId?: string;
      since?: Date;
      until?: Date;
      limit?: number;
      offset?: number;
    }) => Promise<{
      events: Array<Omit<FakeTimelineRow, 'payload'> & { payload: unknown }>;
      total: number;
      limit: number;
      offset: number;
    }>;
  };
}

/**
 * Creates a fresh fake timeline store.
 *
 * @param start - Initial clock value / 初期時刻
 * @returns Fake store with a timeline-compatible module / 偽タイムライン
 */
export function createTimelineFake(start: Date = new Date('2026-09-10T00:00:00Z')): TimelineFake {
  const rows: FakeTimelineRow[] = [];
  let clock = start;
  let failCount = 0;
  let failType: string | undefined;
  let nextId = 1;

  const fake: TimelineFake = {
    rows,
    now: () => clock,
    setNow: (d) => {
      clock = d;
    },
    failNextAppends: (count, eventType) => {
      failCount = count;
      failType = eventType;
    },
    seed: (row) => {
      rows.push({
        id: nextId++,
        eventType: row.eventType,
        actorType: 'system',
        actorId: null,
        payload: JSON.stringify(row.payload),
        correlationId: row.correlationId ?? null,
        createdAt: row.createdAt,
      });
    },
    module: {
      appendEvent: async (event) => {
        if (failCount > 0 && (!failType || failType === event.eventType)) {
          failCount -= 1;
          throw new Error('simulated timeline write failure');
        }
        const id = nextId++;
        rows.push({
          id,
          eventType: event.eventType,
          actorType: event.actorType ?? 'system',
          actorId: event.actorId ?? null,
          payload: JSON.stringify(event.payload ?? {}),
          correlationId: event.correlationId ?? null,
          createdAt: clock,
        });
        return { id };
      },
      queryEvents: async (options = {}) => {
        const { limit = 50, offset = 0 } = options;
        const matched = rows
          .filter((r) => !options.eventType || r.eventType === options.eventType)
          .filter((r) => !options.actorType || r.actorType === options.actorType)
          .filter((r) => !options.correlationId || r.correlationId === options.correlationId)
          .filter((r) => !options.since || r.createdAt >= options.since)
          .filter((r) => !options.until || r.createdAt <= options.until)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
        return {
          events: matched
            .slice(offset, offset + limit)
            .map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
          total: matched.length,
          limit,
          offset,
        };
      },
    },
  };
  return fake;
}

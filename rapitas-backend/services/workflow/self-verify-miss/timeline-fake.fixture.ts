/**
 * timeline-fake.fixture
 *
 * An in-memory stand-in for services/memory/timeline.ts, installed with
 * mock.module, so self-verify-miss tests can seed verification jobs and read
 * back the misses without a database. Import it before the module under
 * test. Contains no tests.
 */
import { mock } from 'bun:test';

/** One stored event, payload already parsed (as queryEvents returns it). */
export interface FakeEvent {
  id: number;
  eventType: string;
  actorType: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export const fakeEvents: FakeEvent[] = [];
let seq = 0;
/** Clock the next appended event is stamped with; tests move it. */
export const fakeClock = { now: new Date('2026-11-27T12:00:00Z') };

/** Called before every append; a test can inject a concurrent write here. */
export const appendHooks: Array<() => void> = [];

/** Store an event the way appendEvent would. */
export function seedEvent(
  eventType: string,
  correlationId: string,
  payload: Record<string, unknown>,
  createdAt: Date = new Date(fakeClock.now.getTime() + seq * 1000),
): FakeEvent {
  const ev = { id: ++seq, eventType, actorType: 'system', correlationId, payload, createdAt };
  fakeEvents.push(ev);
  return ev;
}

export const queryHooks: Array<(eventType: string | undefined) => void> = [];

export const appendEventMock = mock(
  async (event: {
    eventType: string;
    payload?: Record<string, unknown>;
    correlationId?: string;
  }) => {
    for (const h of appendHooks) h();
    const ev = seedEvent(event.eventType, event.correlationId ?? '', event.payload ?? {});
    return { id: ev.id };
  },
);

mock.module('../../memory/timeline', () => ({
  appendEvent: appendEventMock,
  deleteEvents: async () => 0,
  queryEvents: async (
    o: {
      eventType?: string;
      correlationId?: string;
      since?: Date;
      until?: Date;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const hits = fakeEvents
      .filter((e) => !o.eventType || e.eventType === o.eventType)
      .filter((e) => !o.correlationId || e.correlationId === o.correlationId)
      .filter((e) => !o.since || e.createdAt >= o.since)
      .filter((e) => !o.until || e.createdAt <= o.until)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    const limit = o.limit ?? 50;
    const offset = o.offset ?? 0;
    // After the read: a hook models a write that lands just after this query.
    for (const h of queryHooks) h(o.eventType);
    return { events: hits.slice(offset, offset + limit), total: hits.length, limit, offset };
  },
}));

/** Forget every event and hook. */
export function resetFakeTimeline(): void {
  fakeEvents.length = 0;
  appendHooks.length = 0;
  queryHooks.length = 0;
  appendEventMock.mockClear();
  seq = 0;
}

/**
 * Seed one finished self-verify job (start + finish rows).
 *
 * @param taskId - Task / タスク
 * @param runId - Job id / ジョブID
 * @param over - ok / unverifiable / status / revision / changedFiles / createdAt
 */
export function seedJob(
  taskId: number,
  runId: string,
  over: {
    ok?: boolean;
    unverifiable?: boolean;
    status?: 'completed' | 'failed';
    revision?: string;
    changedFiles?: string[];
    at?: Date;
  } = {},
): void {
  const at = over.at ?? new Date(fakeClock.now.getTime() + ++seq * 1000);
  seedEvent(
    'verification_job_started',
    `verify-job-${taskId}`,
    { runId, taskId, startedAt: at.toISOString(), revision: over.revision ?? `sha-${runId}` },
    new Date(at.getTime() - 500),
  );
  seedEvent(
    'verification_job_finished',
    `verify-job-${taskId}`,
    {
      runId,
      taskId,
      status: over.status ?? 'completed',
      ok: over.ok ?? true,
      unverifiable: over.unverifiable ?? false,
      changedFiles: over.changedFiles ?? ['rapitas-backend/services/a.ts'],
      finishedAt: at.toISOString(),
    },
    at,
  );
}

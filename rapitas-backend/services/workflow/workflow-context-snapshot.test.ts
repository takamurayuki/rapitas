/**
 * workflow-context-snapshot.test
 *
 * Holding the retrieved half of a task's context still.
 *
 * Every phase of a task used to retrieve afresh, so the researcher, the
 * planner, the implementer and each repair iteration were each handed a
 * different view of the knowledge base — measured at ~4,000 estimated
 * tokens per role, and 62.2% of the researcher's entire prompt. A repair
 * loop under those conditions is not comparing a fix against its
 * predecessor; it is comparing two different questions.
 *
 * So the tests are about exactly that: the second caller gets the first
 * caller's text, the retrieval does not run twice, and every way this can
 * go wrong leaves the phase with a usable context anyway — a snapshot store
 * that is down must never be able to stop work.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

interface StoredEvent {
  eventType: string;
  correlationId?: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

let stored: StoredEvent[] = [];
let appendFails = false;
let queryFails = false;


mock.module('../memory/timeline', () => ({
  appendEvent: async (event: {
    eventType: string;
    correlationId?: string;
    payload: Record<string, unknown>;
  }) => {
    if (appendFails) throw new Error('timeline unavailable');
    stored.push({ ...event, createdAt: new Date() });
    return { id: stored.length };
  },
  queryEvents: async (options: { eventType?: string; correlationId?: string }) => {
    if (queryFails) throw new Error('timeline unavailable');
    const events = stored
      .filter(
        (e) =>
          (!options.eventType || e.eventType === options.eventType) &&
          (!options.correlationId || e.correlationId === options.correlationId),
      )
      .map((e) => ({ ...e }));
    return { events, total: events.length, limit: 50, offset: 0 };
  },
  deleteEvents: async (filter: { eventType: string; correlationId: string }) => {
    const before = stored.length;
    stored = stored.filter(
      (e) => !(e.eventType === filter.eventType && e.correlationId === filter.correlationId),
    );
    return before - stored.length;
  },
}));

const { snapshotSection, invalidateContextSnapshots, snapshotEnabled, SNAPSHOT_TTL_MS } =
  await import('./workflow-context-snapshot');

/** A retrieval that answers differently every time, as the real one does. */
const drifting = () => {
  let n = 0;
  const calls = () => n;
  const compute = async () => {
    n += 1;
    return `recalled-${n}`;
  };
  return { compute, calls };
};

beforeEach(async () => {
  stored = [];
  appendFails = false;
  queryFails = false;
  delete process.env.RAPITAS_CONTEXT_SNAPSHOT;
  // The module keeps one task's snapshots in memory briefly so a phase does
  // not read the timeline once per section. Clearing it through the public
  // entry point keeps the tests honest about what that entry point does.
  for (const taskId of [7, 8, 9]) await invalidateContextSnapshots(taskId);
});

describe('freezing a section for the life of a task', () => {
  test('hands the second phase what the first one saw', async () => {
    const r = drifting();
    const first = await snapshotSection(7, 'memory', r.compute);
    const second = await snapshotSection(7, 'memory', r.compute);
    expect(second).toBe(first);
  });

  test('does not retrieve twice', async () => {
    // The point is not only the same text: retrieval is a vector search
    // plus a lexical pass per phase.
    const r = drifting();
    await snapshotSection(7, 'memory', r.compute);
    await snapshotSection(7, 'memory', r.compute);
    await snapshotSection(7, 'memory', r.compute);
    expect(r.calls()).toBe(1);
  });

  test('keeps each section apart', async () => {
    await snapshotSection(7, 'memory', async () => 'the memory');
    const other = await snapshotSection(7, 'case', async () => 'the case');
    expect(other).toBe('the case');
  });

  test('keeps each task apart', async () => {
    await snapshotSection(7, 'memory', async () => 'task sevens memory');
    const other = await snapshotSection(8, 'memory', async () => 'task eights memory');
    expect(other).toBe('task eights memory');
  });

  test('refreshes once the snapshot is older than a day', async () => {
    // A task still running tomorrow has been through something, and
    // deserves what the knowledge base knows now. Seeded as an already-old
    // row on a task this process has not read, which is the production
    // path — moving the clock would only test the mock.
    stored.push({
      eventType: 'context_snapshot',
      correlationId: 'task_9',
      payload: { taskId: 9, section: 'memory', content: 'yesterdays recall' },
      createdAt: new Date(Date.now() - SNAPSHOT_TTL_MS - 60_000),
    });
    const r = drifting();
    expect(await snapshotSection(9, 'memory', r.compute)).toBe('recalled-1');
    expect(r.calls()).toBe(1);
  });

  test('keeps using a snapshot that is still within the day', async () => {
    stored.push({
      eventType: 'context_snapshot',
      correlationId: 'task_9',
      payload: { taskId: 9, section: 'memory', content: 'this mornings recall' },
      createdAt: new Date(Date.now() - SNAPSHOT_TTL_MS + 60_000),
    });
    const r = drifting();
    expect(await snapshotSection(9, 'memory', r.compute)).toBe('this mornings recall');
    expect(r.calls()).toBe(0);
  });

  test('does not freeze an empty retrieval', async () => {
    // Pinning "nothing was found" for a day over a knowledge base that may
    // learn something an hour later is the one case worth re-asking.
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return calls === 1 ? '' : 'found something';
    };
    expect(await snapshotSection(7, 'memory', compute)).toBe('');
    expect(await snapshotSection(7, 'memory', compute)).toBe('found something');
  });
});

describe('when it cannot do its job', () => {
  test('still returns a context when the store cannot be read', async () => {
    queryFails = true;
    expect(await snapshotSection(7, 'memory', async () => 'fresh')).toBe('fresh');
  });

  test('still returns a context when the store cannot be written', async () => {
    appendFails = true;
    expect(await snapshotSection(7, 'memory', async () => 'fresh')).toBe('fresh');
  });

  test('ignores a task id that is not one', async () => {
    expect(await snapshotSection(0, 'memory', async () => 'fresh')).toBe('fresh');
    expect(stored).toHaveLength(0);
  });
});

describe('turning it off', () => {
  test('retrieves afresh every time, as before', async () => {
    process.env.RAPITAS_CONTEXT_SNAPSHOT = 'off';
    const r = drifting();
    const first = await snapshotSection(7, 'memory', r.compute);
    const second = await snapshotSection(7, 'memory', r.compute);
    expect(second).not.toBe(first);
    expect(r.calls()).toBe(2);
  });

  test('is on unless it is switched off', () => {
    expect(snapshotEnabled(undefined)).toBe(true);
    expect(snapshotEnabled('')).toBe(true);
    expect(snapshotEnabled('off')).toBe(false);
    expect(snapshotEnabled('FALSE')).toBe(false);
    expect(snapshotEnabled('0')).toBe(false);
  });
});

describe('starting a task over', () => {
  test('drops what was frozen, so the retry sees the world as it is now', async () => {
    const r = drifting();
    const before = await snapshotSection(7, 'memory', r.compute);
    const dropped = await invalidateContextSnapshots(7);
    const after = await snapshotSection(7, 'memory', r.compute);
    expect(dropped).toBe(1);
    expect(after).not.toBe(before);
  });

  test('leaves other tasks alone', async () => {
    await snapshotSection(7, 'memory', async () => 'sevens');
    await snapshotSection(8, 'memory', async () => 'eights');
    await invalidateContextSnapshots(7);
    expect(await snapshotSection(8, 'memory', async () => 'recomputed')).toBe('eights');
  });
});

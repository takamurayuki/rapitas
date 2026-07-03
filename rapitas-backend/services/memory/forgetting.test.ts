/**
 * forgetting テスト
 *
 * Three-stage forgetting: the decay formula
 * (decayScore * 0.95^daysSinceLastAccess * (0.5 + confidence*0.5)), the
 * active/dormant/archived stage thresholds, pinned-entry exclusion, and the
 * outcome-gated boost/penalize deltas.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

type Entry = {
  id: number;
  decayScore: number;
  confidence: number;
  lastAccessedAt: Date | null;
  lastDecayAt: Date;
  forgettingStage: string;
  pinnedUntil: Date | null;
};

let entries: Entry[] = [];
let entry: Entry | null = null;
const updateCalls: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
const createEventCalls: Array<Record<string, unknown>> = [];

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: () => Promise.resolve(entries),
      findUnique: () => Promise.resolve(entry),
      update: (args: { where: { id: number }; data: Record<string, unknown> }) => {
        updateCalls.push(args);
        return Promise.resolve({});
      },
    },
    timelineEvent: {
      create: (args: { data: Record<string, unknown> }) => {
        createEventCalls.push(args.data);
        return Promise.resolve({ id: 1 });
      },
    },
  },
}));

const { runForgettingSweep, boostDecayOnAccess, penalizeOnFailure } = await import('./forgetting');

beforeEach(() => {
  entries = [];
  entry = null;
  updateCalls.length = 0;
  createEventCalls.length = 0;
});

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

describe('runForgettingSweep — decay formula & stage transitions', () => {
  test('no elapsed time and full confidence → decay barely changes, stays active', async () => {
    entries = [
      {
        id: 1,
        decayScore: 0.9,
        confidence: 1,
        lastAccessedAt: new Date(),
        lastDecayAt: new Date(),
        forgettingStage: 'active',
        pinnedUntil: null,
      },
    ];
    const result = await runForgettingSweep();
    expect(result.processed).toBe(1);
    expect(result.transitioned).toEqual({ toDormant: 0, toArchived: 0 });
    const written = updateCalls[0].data.decayScore as number;
    // days=0 → 0.95^0=1; confidence=1 → factor 1 → decay unchanged.
    expect(written).toBeCloseTo(0.9, 5);
    expect(updateCalls[0].data.forgettingStage).toBe('active');
  });

  test('confidence 0 halves the decay via the (0.5 + confidence*0.5) factor', async () => {
    entries = [
      {
        id: 2,
        decayScore: 0.8,
        confidence: 0,
        lastAccessedAt: new Date(),
        lastDecayAt: new Date(),
        forgettingStage: 'active',
        pinnedUntil: null,
      },
    ];
    await runForgettingSweep();
    const written = updateCalls[0].data.decayScore as number;
    expect(written).toBeCloseTo(0.4, 5);
  });

  test('an entry that decays below 0.5 transitions active → dormant', async () => {
    entries = [
      {
        id: 3,
        decayScore: 0.6,
        confidence: 0.5,
        // 0.6 * 0.95^10 * 0.75 ≈ 0.6 * 0.5987 * 0.75 ≈ 0.269 — in [0.1, 0.5).
        lastAccessedAt: daysAgo(10),
        lastDecayAt: daysAgo(10),
        forgettingStage: 'active',
        pinnedUntil: null,
      },
    ];
    const result = await runForgettingSweep();
    expect(result.transitioned.toDormant).toBe(1);
    expect(result.transitioned.toArchived).toBe(0);
    expect(updateCalls[0].data.forgettingStage).toBe('dormant');
  });

  test('an entry that decays below 0.1 transitions to archived', async () => {
    entries = [
      {
        id: 4,
        decayScore: 0.6,
        confidence: 0.5,
        lastAccessedAt: daysAgo(200),
        lastDecayAt: daysAgo(200),
        forgettingStage: 'dormant',
        pinnedUntil: null,
      },
    ];
    const result = await runForgettingSweep();
    expect(result.transitioned.toArchived).toBe(1);
    expect(updateCalls[0].data.forgettingStage).toBe('archived');
  });

  test('boundary: decayScore exactly 0.5 stays active (>= 0.5 is active)', async () => {
    entries = [
      {
        id: 5,
        decayScore: 0.5,
        confidence: 1,
        lastAccessedAt: new Date(),
        lastDecayAt: new Date(),
        forgettingStage: 'active',
        pinnedUntil: null,
      },
    ];
    await runForgettingSweep();
    expect(updateCalls[0].data.forgettingStage).toBe('active');
  });

  test('pinned entries (pinnedUntil in the future) are excluded from processing', async () => {
    entries = [
      {
        id: 6,
        decayScore: 0.9,
        confidence: 1,
        lastAccessedAt: daysAgo(365),
        lastDecayAt: daysAgo(365),
        forgettingStage: 'active',
        pinnedUntil: new Date(Date.now() + DAY_MS), // pinned until tomorrow
      },
    ];
    const result = await runForgettingSweep();
    expect(result.processed).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });

  test('an entry whose pin already expired IS processed', async () => {
    entries = [
      {
        id: 7,
        decayScore: 0.9,
        confidence: 1,
        lastAccessedAt: new Date(),
        lastDecayAt: new Date(),
        forgettingStage: 'active',
        pinnedUntil: daysAgo(1), // expired yesterday
      },
    ];
    const result = await runForgettingSweep();
    expect(result.processed).toBe(1);
  });

  test('falls back to lastDecayAt when lastAccessedAt is null', async () => {
    entries = [
      {
        id: 8,
        decayScore: 0.6,
        confidence: 0.5,
        lastAccessedAt: null,
        lastDecayAt: daysAgo(10),
        forgettingStage: 'active',
        pinnedUntil: null,
      },
    ];
    const result = await runForgettingSweep();
    expect(result.transitioned.toDormant).toBe(1);
  });

  test('records a timeline event summarizing the sweep', async () => {
    entries = [
      {
        id: 9,
        decayScore: 0.9,
        confidence: 1,
        lastAccessedAt: new Date(),
        lastDecayAt: new Date(),
        forgettingStage: 'active',
        pinnedUntil: null,
      },
    ];
    await runForgettingSweep();
    expect(createEventCalls).toHaveLength(1);
    expect(createEventCalls[0].eventType).toBe('forgetting_sweep');
  });
});

describe('boostDecayOnAccess', () => {
  test('raises decayScore by the given delta, capped at 1.0', async () => {
    entry = { id: 1, decayScore: 0.9 } as Entry;
    await boostDecayOnAccess(1, 0.3);
    expect(updateCalls[0].data.decayScore).toBe(1.0);
    expect(updateCalls[0].data.forgettingStage).toBe('active');
  });

  test('default delta is 0.3 when not specified', async () => {
    entry = { id: 2, decayScore: 0.2 } as Entry;
    await boostDecayOnAccess(2);
    expect(updateCalls[0].data.decayScore).toBeCloseTo(0.5, 5);
  });

  test('increments accessCount and updates lastAccessedAt', async () => {
    entry = { id: 3, decayScore: 0.1 } as Entry;
    await boostDecayOnAccess(3, 0.05);
    expect(updateCalls[0].data.accessCount).toEqual({ increment: 1 });
    expect(updateCalls[0].data.lastAccessedAt).toBeInstanceOf(Date);
  });

  test('a boost that crosses back into "active" updates the stage accordingly', async () => {
    entry = { id: 4, decayScore: 0.45 } as Entry;
    await boostDecayOnAccess(4, 0.1); // → 0.55, crosses the 0.5 active threshold
    expect(updateCalls[0].data.forgettingStage).toBe('active');
  });

  test('no-op when the entry does not exist', async () => {
    entry = null;
    await boostDecayOnAccess(999);
    expect(updateCalls).toHaveLength(0);
  });
});

describe('penalizeOnFailure', () => {
  test('lowers decayScore by the given delta, floored at 0', async () => {
    entry = { id: 1, decayScore: 0.1 } as Entry;
    await penalizeOnFailure(1, 0.2);
    expect(updateCalls[0].data.decayScore).toBe(0);
  });

  test('default delta is 0.2 when not specified', async () => {
    entry = { id: 2, decayScore: 0.5 } as Entry;
    await penalizeOnFailure(2);
    expect(updateCalls[0].data.decayScore).toBeCloseTo(0.3, 5);
  });

  test('does NOT increment accessCount (a failure is not a useful access)', async () => {
    entry = { id: 3, decayScore: 0.5 } as Entry;
    await penalizeOnFailure(3);
    expect(updateCalls[0].data.accessCount).toBeUndefined();
    expect(updateCalls[0].data.lastAccessedAt).toBeUndefined();
  });

  test('a penalty that crosses below 0.5 demotes the stage to dormant', async () => {
    entry = { id: 4, decayScore: 0.55 } as Entry;
    await penalizeOnFailure(4, 0.1); // → 0.45, drops below active threshold
    expect(updateCalls[0].data.forgettingStage).toBe('dormant');
  });

  test('no-op when the entry does not exist', async () => {
    entry = null;
    await penalizeOnFailure(999);
    expect(updateCalls).toHaveLength(0);
  });
});

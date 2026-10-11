/**
 * usage-budget-service unit tests
 *
 * Runs the service against an in-memory store: status without a budget,
 * 80/90/exceeded levels with forecasts, CAS-guarded single notification,
 * rollback when the notification fails, the three prompt actions, input
 * validation, and that nothing here ever blocks an execution.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  createUsageBudgetService,
  UsageBudgetValidationError,
  type UsageBudgetDeps,
} from './usage-budget-service';
import { MemoryStore } from './usage-budget-memory-store.test-helpers';
import type { BudgetConfig, ExecutionUsageSample, PendingPrompt } from './usage-budget-types';

const NOW = new Date('2026-10-10T12:00:00Z');

let store: MemoryStore;
let samples: ExecutionUsageSample[];
let notified: PendingPrompt[];
let notifyImpl: (p: PendingPrompt) => Promise<void>;

function s(at: string, tokens: number, themeId = 1): ExecutionUsageSample {
  return { at: new Date(at), tokens, durationMs: 1000, costUsd: 0, themeId };
}

function service() {
  const deps: UsageBudgetDeps = {
    store,
    loadSamples: async (since) => ({
      samples: samples.filter((x) => x.at >= since),
      unresolvedCount: 0,
    }),
    loadThemeNames: async (ids) => new Map(ids.filter((id) => id > 0).map((id) => [id, `T${id}`])),
    notify: (p) => notifyImpl(p),
    now: () => NOW,
  };
  return createUsageBudgetService(deps);
}

beforeEach(() => {
  store = new MemoryStore();
  samples = [];
  notified = [];
  notifyImpl = async (p) => {
    notified.push(p);
  };
});

async function configure(limit: number, unit: BudgetConfig['unit'] = 'tokens') {
  await store.saveBudget({ unit, monthlyLimit: limit });
}

describe('getStatus', () => {
  test('without a budget returns configured:false with a 30-day share suggestion', async () => {
    samples = [s('2026-10-09T00:00:00Z', 300, 1), s('2026-10-09T00:00:00Z', 100, 2)];
    const st = await service().getStatus(0);
    expect(st.configured).toBe(false);
    expect(st.suggestedShares).toEqual([
      { themeId: 1, sharePercent: 75, themeName: 'T1' },
      { themeId: 2, sharePercent: 25, themeName: 'T2' },
    ]);
  });

  test('suggestion is empty with a reason when there is no usage', async () => {
    const st = await service().getStatus(0);
    expect(st.suggestedShares).toEqual([]);
    expect(st.suggestionReason).toBe('no_usage_in_last_30_days');
  });

  test('counts only this month for usage but last month days for avg7', async () => {
    await configure(1000);
    samples = [s('2026-09-30T10:00:00Z', 500), s('2026-10-10T01:00:00Z', 200)];
    const st = await service().getStatus(0);
    if (!st.configured) throw new Error('expected configured');
    expect(st.projection.used).toBe(200);
    // 9/30 .. 10/10 is outside the 7-day window (10/04..10/10) → only 200 over 1 day.
    expect(st.projection.avg7).toBe(200);
  });

  test('per-theme usage includes allocation from manual shares', async () => {
    await store.saveBudget({
      unit: 'tokens',
      monthlyLimit: 1000,
      shares: [
        { themeId: 1, sharePercent: 60 },
        { themeId: 3, sharePercent: 40 },
      ],
    });
    samples = [s('2026-10-10T01:00:00Z', 100, 1)];
    const st = await service().getStatus(0);
    if (!st.configured) throw new Error('expected configured');
    expect(st.themes).toEqual([
      { themeId: 1, themeName: 'T1', used: 100, sharePercent: 60, allocated: 600 },
      { themeId: 3, themeName: 'T3', used: 0, sharePercent: 40, allocated: 400 },
    ]);
  });

  test('executions unit counts executions', async () => {
    await configure(10, 'executions');
    samples = [s('2026-10-10T01:00:00Z', 99999), s('2026-10-10T02:00:00Z', 99999)];
    const st = await service().getStatus(0);
    if (!st.configured) throw new Error('expected configured');
    expect(st.projection.used).toBe(2);
    expect(st.pendingPrompt).toBeNull();
  });
});

describe('evaluate', () => {
  test('at 80% returns a pending prompt with the forecast and notifies once', async () => {
    await configure(1000);
    samples = [s('2026-10-08T00:00:00Z', 400), s('2026-10-10T00:00:00Z', 400)];
    const r = await service().evaluate(0);
    expect(r.notified).toBe(true);
    expect(r.configured && r.pendingPrompt).toMatchObject({
      key: '2026-10:warn80',
      level: 'warn80',
      remaining: 200,
      daysToExhaust: 200 / (800 / 3),
    });
    expect(notified).toHaveLength(1);

    const again = await service().evaluate(0);
    expect(again.notified).toBe(false);
    expect(notified).toHaveLength(1);
  });

  test('concurrent evaluate calls notify exactly once (CAS)', async () => {
    await configure(1000);
    samples = [s('2026-10-10T00:00:00Z', 950)];
    const svc = service();
    const results = await Promise.all([svc.evaluate(0), svc.evaluate(0), svc.evaluate(0)]);
    expect(results.filter((r) => r.notified)).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(notified[0].level).toBe('warn90');
  });

  test('jumping 70% → 95% notifies only the highest level', async () => {
    await configure(1000);
    samples = [s('2026-10-10T00:00:00Z', 950)];
    await service().evaluate(0);
    expect(notified.map((p) => p.level)).toEqual(['warn90']);
  });

  test('restores lastNotifiedKey when the notification fails', async () => {
    await configure(1000);
    samples = [s('2026-10-10T00:00:00Z', 850)];
    notifyImpl = async () => {
      throw new Error('db write failed');
    };
    const r = await service().evaluate(0);
    expect(r.notified).toBe(false);
    expect(store.config?.lastNotifiedKey).toBeNull();
    notifyImpl = async (p) => {
      notified.push(p);
    };
    expect((await service().evaluate(0)).notified).toBe(true);
  });

  test('below 80% neither prompts nor notifies', async () => {
    await configure(1000);
    samples = [s('2026-10-10T00:00:00Z', 799)];
    const r = await service().evaluate(0);
    expect(r.configured && r.pendingPrompt).toBeNull();
    expect(notified).toHaveLength(0);
  });

  test('without a budget nothing is notified', async () => {
    samples = [s('2026-10-10T00:00:00Z', 10_000)];
    const r = await service().evaluate(0);
    expect(r.configured).toBe(false);
    expect(notified).toHaveLength(0);
  });
});

describe('respondToPrompt', () => {
  beforeEach(async () => {
    await configure(1000);
    samples = [s('2026-10-10T00:00:00Z', 1200)];
  });

  test('exceeded still only produces a prompt — continue acknowledges it', async () => {
    const before = await service().evaluate(0);
    expect(before.configured && before.pendingPrompt?.level).toBe('exceeded');
    const after = await service().respondToPrompt({ action: 'continue' }, 0);
    expect(after.configured && after.pendingPrompt).toBeNull();
    expect(store.config?.acknowledgedKey).toBe('2026-10:exceeded');
  });

  test('defer snoozes the prompt for 24 hours', async () => {
    const after = await service().respondToPrompt({ action: 'defer' }, 0);
    expect(after.configured && after.pendingPrompt).toBeNull();
    expect(store.config?.snoozedUntil?.toISOString()).toBe('2026-10-11T12:00:00.000Z');
  });

  test('change_limit raises the limit and clears the prompt when below it', async () => {
    const after = await service().respondToPrompt(
      { action: 'change_limit', monthlyLimit: 5000 },
      0,
    );
    expect(store.config?.monthlyLimit).toBe(5000);
    expect(after.configured && after.projection.level).toBe('none');
    expect(after.configured && after.pendingPrompt).toBeNull();
  });

  test('change_limit below usage clears 続行/後回し so the prompt shows again', async () => {
    await service().respondToPrompt({ action: 'continue' }, 0);
    await service().respondToPrompt({ action: 'defer' }, 0);
    const after = await service().respondToPrompt({ action: 'change_limit', monthlyLimit: 500 }, 0);
    expect(store.config?.acknowledgedKey).toBeNull();
    expect(store.config?.snoozedUntil).toBeNull();
    expect(after.configured && after.pendingPrompt?.level).toBe('exceeded');
  });

  test('rejects an unknown action and an invalid new limit', async () => {
    await expect(service().respondToPrompt({ action: 'stop' }, 0)).rejects.toBeInstanceOf(
      UsageBudgetValidationError,
    );
    await expect(
      service().respondToPrompt({ action: 'change_limit', monthlyLimit: 0 }, 0),
    ).rejects.toBeInstanceOf(UsageBudgetValidationError);
  });
});

describe('updateBudget', () => {
  test('saves unit, limit and shares', async () => {
    const st = await service().updateBudget(
      { unit: 'executions', monthlyLimit: 50, shares: [{ themeId: 0, sharePercent: 100 }] },
      0,
    );
    expect(st.configured).toBe(true);
    expect(store.config).toMatchObject({ unit: 'executions', monthlyLimit: 50 });
    expect(store.shares).toEqual([{ themeId: 0, sharePercent: 100 }]);
  });

  test.each([
    [{ unit: 'usd', monthlyLimit: 10 }],
    [{ unit: 'tokens', monthlyLimit: 0 }],
    [{ unit: 'tokens', monthlyLimit: -1 }],
    [
      {
        unit: 'tokens',
        monthlyLimit: 10,
        shares: [
          { themeId: 1, sharePercent: 70 },
          { themeId: 2, sharePercent: 31 },
        ],
      },
    ],
  ])('rejects %j', async (body) => {
    await expect(service().updateBudget(body, 0)).rejects.toBeInstanceOf(
      UsageBudgetValidationError,
    );
    expect(store.config).toBeNull();
  });
});

describe('replaceRules', () => {
  test('stores trimmed rules with default sortOrder and enabled', async () => {
    const rules = await service().replaceRules([{ themeId: 2, keyword: ' bug ' }]);
    expect(rules).toEqual([{ id: 1, themeId: 2, keyword: 'bug', sortOrder: 0, enabled: true }]);
  });

  test('rejects empty keywords and non-positive themeIds', async () => {
    await expect(service().replaceRules([{ themeId: 2, keyword: ' ' }])).rejects.toBeInstanceOf(
      UsageBudgetValidationError,
    );
    await expect(service().replaceRules([{ themeId: 0, keyword: 'x' }])).rejects.toBeInstanceOf(
      UsageBudgetValidationError,
    );
    await expect(service().replaceRules('nope')).rejects.toBeInstanceOf(UsageBudgetValidationError);
  });
});

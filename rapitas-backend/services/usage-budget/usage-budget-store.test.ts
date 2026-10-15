/**
 * usage-budget-store unit tests
 *
 * Runs the store over a fake UsageBudgetDb: the CAS claim (including the
 * first claim where lastNotifiedKey is NULL), release only when unchanged,
 * share/rule replacement, and the explicit error when the running Prisma
 * client predates usage-budget.prisma (premortem #1 of the plan).
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { createUsageBudgetStore, type UsageBudgetDb } from './usage-budget-store';

type Row = {
  unit: string;
  monthlyLimit: number;
  snoozedUntil: Date | null;
  acknowledgedKey: string | null;
  lastNotifiedKey: string | null;
};

/** Evaluate the small subset of Prisma `where` shapes the store emits. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'id') continue;
    if (k === 'OR') {
      if (!(v as Array<Record<string, unknown>>).some((w) => matches(row, w))) return false;
      continue;
    }
    const actual = row[k as keyof Row];
    if (v !== null && typeof v === 'object' && 'not' in (v as object)) {
      // SQL semantics: NULL <> x is not true.
      if (actual === null || actual === (v as { not: unknown }).not) return false;
    } else if (actual !== v) {
      return false;
    }
  }
  return true;
}

function fakeDb() {
  const state = {
    row: null as Row | null,
    shares: [] as Array<{ budgetId: number; themeId: number; sharePercent: number }>,
    rules: [] as Array<{
      id: number;
      themeId: number;
      keyword: string;
      sortOrder: number;
      enabled: boolean;
    }>,
  };
  const db: UsageBudgetDb = {
    usageBudget: {
      findUnique: async () => (state.row ? { ...state.row } : null),
      upsert: async ({ create, update }) => {
        state.row = state.row
          ? { ...state.row, ...update }
          : {
              snoozedUntil: null,
              acknowledgedKey: null,
              lastNotifiedKey: null,
              ...create,
            };
        return state.row;
      },
      updateMany: async ({ where, data }) => {
        if (!state.row || !matches(state.row, where)) return { count: 0 };
        state.row = { ...state.row, ...data };
        return { count: 1 };
      },
    },
    usageBudgetThemeShare: {
      findMany: async () =>
        state.shares.map((s) => ({ themeId: s.themeId, sharePercent: s.sharePercent })),
      deleteMany: async () => {
        state.shares = [];
      },
      create: async ({ data }) => {
        state.shares.push(data);
      },
    },
    usageClassificationRule: {
      findMany: async () => [...state.rules].sort((a, b) => a.sortOrder - b.sortOrder),
      deleteMany: async () => {
        state.rules = [];
      },
      create: async ({ data }) => {
        state.rules.push({ id: state.rules.length + 1, ...data });
      },
    },
    $transaction: async (fn) => fn(db),
  };
  return { db, state };
}

let f: ReturnType<typeof fakeDb>;
beforeEach(() => {
  f = fakeDb();
});

describe('createUsageBudgetStore', () => {
  test('getConfig is null until a budget is saved', async () => {
    const store = createUsageBudgetStore(f.db);
    expect(await store.getConfig()).toBeNull();
    await store.saveBudget({ unit: 'executions', monthlyLimit: 30 });
    expect(await store.getConfig()).toMatchObject({ unit: 'executions', monthlyLimit: 30 });
  });

  test('saveBudget replaces shares only when given', async () => {
    const store = createUsageBudgetStore(f.db);
    await store.saveBudget({
      unit: 'tokens',
      monthlyLimit: 10,
      shares: [{ themeId: 1, sharePercent: 50 }],
    });
    await store.saveBudget({ unit: 'tokens', monthlyLimit: 20 });
    expect(await store.getShares()).toEqual([{ themeId: 1, sharePercent: 50 }]);
    await store.saveBudget({ unit: 'tokens', monthlyLimit: 20, shares: [] });
    expect(await store.getShares()).toEqual([]);
  });

  test('claimNotification wins the first claim (NULL key) and only once per key', async () => {
    const store = createUsageBudgetStore(f.db);
    await store.saveBudget({ unit: 'tokens', monthlyLimit: 10 });
    expect(await store.claimNotification('2026-10:warn80')).toBe(true);
    expect(await store.claimNotification('2026-10:warn80')).toBe(false);
    expect(await store.claimNotification('2026-10:warn90')).toBe(true);
  });

  test('releaseNotification restores the previous key only if still ours', async () => {
    const store = createUsageBudgetStore(f.db);
    await store.saveBudget({ unit: 'tokens', monthlyLimit: 10 });
    await store.claimNotification('2026-10:warn80');
    await store.releaseNotification('2026-10:warn80', null);
    expect(f.state.row?.lastNotifiedKey).toBeNull();

    await store.claimNotification('2026-10:warn80');
    await store.claimNotification('2026-10:warn90');
    await store.releaseNotification('2026-10:warn80', null);
    expect(f.state.row?.lastNotifiedKey).toBe('2026-10:warn90');
  });

  test('replaceRules swaps the whole rule list', async () => {
    const store = createUsageBudgetStore(f.db);
    await store.replaceRules([{ themeId: 1, keyword: 'a', sortOrder: 1, enabled: true }]);
    await store.replaceRules([{ themeId: 2, keyword: 'b', sortOrder: 0, enabled: false }]);
    expect(await store.getRules()).toEqual([
      { id: 1, themeId: 2, keyword: 'b', sortOrder: 0, enabled: false },
    ]);
  });

  test('throws an explicit restart hint when the Prisma client lacks the delegates', async () => {
    const store = createUsageBudgetStore({} as unknown as UsageBudgetDb);
    await expect(store.getConfig()).rejects.toThrow(/restart the server/);
  });
});

/**
 * usage-budget-router tests
 *
 * Drives the HTTP contract end-to-end over the real service and an in-memory
 * store: success envelopes, 400 on invalid input (limit ≤ 0, share total > 100,
 * unknown action, bad tz/days), the unconfigured response and GET having no
 * side effects.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createUsageBudgetRouter } from './usage-budget-router';
import { createUsageBudgetService } from '../../../services/usage-budget/usage-budget-service';
import { MemoryStore } from '../../../services/usage-budget/usage-budget-memory-store.test-helpers';
import type { ExecutionUsageSample } from '../../../services/usage-budget/usage-budget-types';
import type { ThemeUsageResult } from './queries/theme-usage';

const NOW = new Date('2026-10-10T12:00:00Z');

let store: MemoryStore;
let samples: ExecutionUsageSample[];
let notifyCount: number;
const themeUsage = mock((_p: unknown) =>
  Promise.resolve({ days: 14, themes: [], daily: [] } as unknown as ThemeUsageResult),
);

function app() {
  const service = createUsageBudgetService({
    store,
    loadSamples: async () => ({ samples, unresolvedCount: 0 }),
    loadThemeNames: async () => new Map(),
    notify: async () => {
      notifyCount += 1;
    },
    now: () => NOW,
  });
  return createUsageBudgetRouter({ service, getThemeUsage: themeUsage });
}

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  store = new MemoryStore();
  samples = [];
  notifyCount = 0;
  themeUsage.mockClear();
});

describe('GET /theme-usage', () => {
  test('passes days, tz offset and the saved rules to the query', async () => {
    store.rules = [{ id: 1, themeId: 2, keyword: 'x', sortOrder: 0, enabled: true }];
    const res = await app().handle(req('GET', '/theme-usage?days=30&tzOffsetMinutes=540'));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(themeUsage.mock.calls[0][0]).toEqual({
      days: 30,
      tzOffsetMinutes: 540,
      rules: store.rules,
    });
  });

  test.each(['/theme-usage?days=0', '/theme-usage?days=91', '/theme-usage?tzOffsetMinutes=900'])(
    '%s → 400',
    async (path) => {
      const res = await app().handle(req('GET', path));
      expect(res.status).toBe(400);
    },
  );
});

describe('usage budget endpoints', () => {
  test('status without a budget is configured:false', async () => {
    const res = await app().handle(req('GET', '/usage-budget/status'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.configured).toBe(false);
  });

  test('PUT saves the budget and GET status reflects it', async () => {
    const put = await app().handle(
      req('PUT', '/usage-budget', {
        unit: 'tokens',
        monthlyLimit: 1000,
        shares: [{ themeId: 1, sharePercent: 100 }],
      }),
    );
    expect(put.status).toBe(200);
    const res = await app().handle(req('GET', '/usage-budget/status'));
    const data = (await res.json()).data;
    expect(data).toMatchObject({ configured: true, unit: 'tokens', monthlyLimit: 1000 });
    expect(data.shares).toEqual([{ themeId: 1, sharePercent: 100 }]);
  });

  test.each([
    [{ unit: 'tokens', monthlyLimit: 0 }],
    [{ unit: 'tokens', monthlyLimit: -10 }],
    [{ unit: 'yen', monthlyLimit: 10 }],
    [
      {
        unit: 'tokens',
        monthlyLimit: 10,
        shares: [
          { themeId: 1, sharePercent: 80 },
          { themeId: 2, sharePercent: 30 },
        ],
      },
    ],
  ])('PUT %j → 400', async (body) => {
    const res = await app().handle(req('PUT', '/usage-budget', body));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  test('GET status has no side effects; POST evaluate notifies once', async () => {
    await store.saveBudget({ unit: 'tokens', monthlyLimit: 1000 });
    samples = [{ at: NOW, tokens: 900, durationMs: 0, costUsd: 0, themeId: 1 }];

    const st = await app().handle(req('GET', '/usage-budget/status'));
    expect((await st.json()).data.pendingPrompt.level).toBe('warn90');
    expect(notifyCount).toBe(0);
    expect(store.config?.lastNotifiedKey).toBeNull();

    const ev = await app().handle(req('POST', '/usage-budget/evaluate'));
    const evData = (await ev.json()).data;
    expect(evData.notified).toBe(true);
    expect(evData.pendingPrompt.daysToExhaust).toBe(100 / 900);
    await app().handle(req('POST', '/usage-budget/evaluate'));
    expect(notifyCount).toBe(1);
  });

  test('prompt-response validates the action and applies continue', async () => {
    await store.saveBudget({ unit: 'tokens', monthlyLimit: 1000 });
    samples = [{ at: NOW, tokens: 1500, durationMs: 0, costUsd: 0, themeId: 1 }];
    const bad = await app().handle(
      req('POST', '/usage-budget/prompt-response', { action: 'halt' }),
    );
    expect(bad.status).toBe(400);
    const ok = await app().handle(
      req('POST', '/usage-budget/prompt-response', { action: 'continue' }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.pendingPrompt).toBeNull();
  });

  test('prompt-response before a budget exists → 400', async () => {
    const res = await app().handle(
      req('POST', '/usage-budget/prompt-response', { action: 'defer' }),
    );
    expect(res.status).toBe(400);
  });

  test('rules round-trip and reject invalid entries', async () => {
    const put = await app().handle(
      req('PUT', '/usage-budget/rules', { rules: [{ themeId: 3, keyword: 'ui' }] }),
    );
    expect(put.status).toBe(200);
    const get = await app().handle(req('GET', '/usage-budget/rules'));
    expect((await get.json()).data).toEqual([
      { id: 1, themeId: 3, keyword: 'ui', sortOrder: 0, enabled: true },
    ]);
    const bad = await app().handle(req('PUT', '/usage-budget/rules', { rules: [{ themeId: 3 }] }));
    expect(bad.status).toBe(400);
  });

  test('a store failure maps to 500', async () => {
    store.getConfig = async () => {
      throw new Error('db down');
    };
    const res = await app().handle(req('GET', '/usage-budget/status'));
    expect(res.status).toBe(500);
  });
});

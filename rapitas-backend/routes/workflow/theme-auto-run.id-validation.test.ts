// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * theme-auto-run.id-validation.test
 *
 * Proves /themes/:id/auto-run refuses an id that names no theme, and refuses it
 * before the auto-run loop is touched.
 *
 * This route was missed by #1349's first six passes: it read
 * `parseInt((context.params as { id: string }).id)` behind a
 * `Number.isFinite` check, and both halves failed — the assertion hid the
 * parameter's origin from require-validated-id-param, and isFinite inspects
 * what parseInt already returned, so '5e2' arrived as 5.
 *
 * The assertions are on the auto-run service, not the status code. Starting or
 * stopping the loop on another theme is the harm: a stop reverts uncommitted
 * work and releases locks, and a start launches agents.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockDb = {
  theme: {
    findUnique: mock(() => Promise.resolve({ id: 5, isDevelopment: true, workingDirectory: '/t' })),
  },
};

const mockGetOrCreate = mock(() =>
  Promise.resolve({ currentTaskId: null, enabled: false, status: 'idle' }),
);
const mockStart = mock(() => Promise.resolve({ enabled: true, status: 'running' }));
const mockPause = mock(() => Promise.resolve({ enabled: false, status: 'paused' }));
const mockStop = mock(() => Promise.resolve({ enabled: false, status: 'stopping' }));
const mockStopThemeAgents = mock(() => Promise.resolve({ stoppedCount: 0, executionIds: [] }));
const mockSettle = mock(() => Promise.resolve([]));
const mockStartScheduler = mock(() => {});

mock.module('../../config', () => ({ prisma: mockDb }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../services/observability', () => ({ logCycleEvent: () => {} }));

mock.module('../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ start: mockStartScheduler }) },
}));

// NOTE: every export mirrored — a missing one makes bun stop this whole file.
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getOrCreateAutoRun: mockGetOrCreate,
  startAutoRun: mockStart,
  pauseAutoRun: mockPause,
  stopAutoRun: mockStop,
  toPublicAutoRunState: (state: unknown) => state,
}));

mock.module('../../services/agents/stop-task-agents', () => ({
  stopThemeAgents: mockStopThemeAgents,
  stopTaskAgents: mock(() => Promise.resolve({ stoppedCount: 0 })),
}));

mock.module('../../services/agents/settle-stopped-tasks', () => ({
  settleStoppedTasks: mockSettle,
}));

const { themeAutoRunRoutes } = await import('./theme-auto-run');

const BASE = 'http://localhost/themes';

function resetMocks() {
  mockDb.theme.findUnique.mockClear();
  mockGetOrCreate.mockClear();
  mockStart.mockClear();
  mockPause.mockClear();
  mockStop.mockClear();
  mockStopThemeAgents.mockClear();
  mockSettle.mockClear();
  mockStartScheduler.mockClear();
}

// '5e2' is 500 and '0x5' is 5 under parseInt; neither is the id that was typed.
const TRUNCATING_IDS: [string, string][] = [
  ['a trailing suffix', '5abc'],
  ['exponent notation', '5e2'],
  ['hex notation', '0x5'],
  ['a decimal', '5.9'],
  ['zero', '0'],
  ['a negative number', '-3'],
];

describe('POST /themes/:id/auto-run — an id that names no theme', () => {
  beforeEach(resetMocks);

  const cases = TRUNCATING_IDS.flatMap(([label, raw]) =>
    ['start', 'pause', 'stop'].map((action) => [label, raw, action] as [string, string, string]),
  );

  it.each(cases)(
    'refuses %s (%s) for action=%s without touching auto-run',
    async (_l, raw, action) => {
      const res = await themeAutoRunRoutes.handle(
        new Request(`${BASE}/${raw}/auto-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      // The loop is never read, started, paused or stopped.
      expect(mockGetOrCreate).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockPause).not.toHaveBeenCalled();
      expect(mockStop).not.toHaveBeenCalled();
      // No agents stopped, no worktrees reverted.
      expect(mockStopThemeAgents).not.toHaveBeenCalled();
      expect(mockDb.theme.findUnique).not.toHaveBeenCalled();
    },
  );
});

describe('GET /themes/:id/auto-run — an id that names no theme', () => {
  beforeEach(resetMocks);

  it.each(TRUNCATING_IDS)('refuses %s (%s) without reading the loop', async (_label, raw) => {
    const res = await themeAutoRunRoutes.handle(new Request(`${BASE}/${raw}/auto-run`));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });
});

describe('a valid id still drives auto-run', () => {
  beforeEach(resetMocks);

  // Over-correction guard: refusing everything would satisfy both blocks above.
  it('starts the loop for the theme the id names', async () => {
    const res = await themeAutoRunRoutes.handle(
      new Request(`${BASE}/5/auto-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockStart).toHaveBeenCalled();
    expect(mockStart.mock.calls[0]?.[0]).toBe(5);
  });
});

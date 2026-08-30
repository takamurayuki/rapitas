/**
 * backlog-task-promoter.test
 *
 * Covers hasPromotableBacklog (no-op preview) and promoteBacklogForTheme
 * (concern-first, idea-second promotion with the outstanding-count cap).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockUserSettingsFindFirst = mock(() =>
  Promise.resolve<{ autoCreateFromBacklogLimit: number } | null>(null),
);
const mockTaskCount = mock(() => Promise.resolve(0));
const mockTaskUpdate = mock(() => Promise.resolve({}));

mock.module('../../../config/database', () => ({
  prisma: {
    userSettings: { findFirst: mockUserSettingsFindFirst },
    task: { count: mockTaskCount, update: mockTaskUpdate },
  },
}));

const noopLog = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
};
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLog,
}));

const mockListConcerns = mock(() =>
  Promise.resolve({ concerns: [] as Array<{ id: number; severity: string }>, total: 0 }),
);
const mockConvertConcernToTask = mock((_id: number) => Promise.resolve<number | null>(null));
// Default concern is agent-filed: the recurrence check only runs for
// source 'log_health', so the existing promotion tests are untouched.
const mockGetConcern = mock((id: number) =>
  Promise.resolve({ id, source: 'agent', title: `concern ${id}` } as never),
);
const mockMarkConcernResolved = mock((_id: number, _resolved: boolean) => Promise.resolve(true));
mock.module('../../memory/concern-backlog-service', () => ({
  listConcerns: mockListConcerns,
  convertConcernToTask: mockConvertConcernToTask,
  getConcern: mockGetConcern,
  markConcernResolved: mockMarkConcernResolved,
}));
// null = unknown (fail open), false = silent for 24h, true = still recurring.
const mockIsLogConcernStillRecurring = mock(() => Promise.resolve(null as boolean | null));
// NOTE: bun's mock.module is process-global, so this replacement also reaches
// log-concern-recurrence.test.ts if both files share a process. The verify gate
// runs test files in isolation; run them the same way locally.
mock.module('./log-concern-recurrence', () => ({
  isLogConcernStillRecurring: mockIsLogConcernStillRecurring,
  // Same contract as the real helper: the fragment after the `[ログ:LEVEL]` mark.
  fragmentFromLogConcernTitle: (title: string | null | undefined) =>
    title && /^\[ログ:(?:FATAL|ERROR|WARN)\]/.test(title)
      ? title.replace(/^\[ログ:[A-Z]+\]\s*/, '')
      : null,
}));

const mockListIdeas = mock(() =>
  Promise.resolve({
    ideas: [] as Array<{
      id: number;
      title: string;
      content: string;
      priority: string;
      themeId: number | null;
    }>,
    total: 0,
  }),
);
const mockMarkIdeaAsUsed = mock((_ideaId: number, _taskId: number) => Promise.resolve());
mock.module('../../memory/idea-box-service', () => ({
  listIdeas: mockListIdeas,
  markIdeaAsUsed: mockMarkIdeaAsUsed,
}));

const mockCreateTask = mock((..._args: unknown[]) =>
  Promise.resolve<{ id: number } | null>({ id: 900 }),
);
mock.module('../../task/task-mutations', () => ({
  createTask: mockCreateTask,
}));

const mockLogCycleEvent = mock(() => {});
mock.module('../../observability', () => ({
  logCycleEvent: mockLogCycleEvent,
}));

// Nightly self-refill gate (task 784) — hasPromotableBacklog delegates the
// window/timer decision here. Defaults to true (window open) so every
// pre-existing hasPromotableBacklog test keeps exercising the cap/backlog
// logic unaffected; the dedicated describe block below overrides it to false.
const mockShouldRefillBacklogNow = mock(() => Promise.resolve(true));
mock.module('./auto-run-idle-timer', () => ({
  IDLE_BYPASS_CONCERN_SEVERITIES: new Set(['urgent', 'high']),
  shouldRefillBacklogNow: mockShouldRefillBacklogNow,
}));

const { hasPromotableBacklog, promoteBacklogForTheme } = await import('./backlog-task-promoter');

function resetMocks() {
  mockUserSettingsFindFirst.mockReset();
  mockUserSettingsFindFirst.mockResolvedValue(null);
  mockTaskCount.mockReset();
  mockTaskCount.mockResolvedValue(0);
  mockTaskUpdate.mockReset();
  mockTaskUpdate.mockResolvedValue({});
  mockListConcerns.mockReset();
  mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
  mockConvertConcernToTask.mockReset();
  mockConvertConcernToTask.mockResolvedValue(null);
  mockListIdeas.mockReset();
  mockListIdeas.mockResolvedValue({ ideas: [], total: 0 });
  mockMarkIdeaAsUsed.mockReset();
  mockMarkIdeaAsUsed.mockResolvedValue(undefined);
  mockCreateTask.mockReset();
  mockCreateTask.mockResolvedValue({ id: 900 });
  mockLogCycleEvent.mockClear();
  noopLog.info.mockClear();
  noopLog.warn.mockClear();
  mockShouldRefillBacklogNow.mockReset();
  mockShouldRefillBacklogNow.mockResolvedValue(true);
}

describe('hasPromotableBacklog', () => {
  beforeEach(resetMocks);

  test('returns false when the backlog limit is disabled (0)', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 0 });
    expect(await hasPromotableBacklog(1)).toBe(false);
    expect(mockTaskCount).not.toHaveBeenCalled();
  });

  test('returns false when UserSettings lookup fails (fail-closed limit)', async () => {
    mockUserSettingsFindFirst.mockRejectedValue(new Error('db down'));
    expect(await hasPromotableBacklog(1)).toBe(false);
  });

  test('returns false when outstanding auto-created tasks already meet the cap', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(2);
    expect(await hasPromotableBacklog(1)).toBe(false);
    expect(mockListConcerns).not.toHaveBeenCalled();
  });

  test('returns true when an open concern exists', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [{ id: 1, severity: 'high' }], total: 1 });
    expect(await hasPromotableBacklog(1)).toBe(true);
    expect(mockListIdeas).not.toHaveBeenCalled();
  });

  test('falls through to ideas when there are no open concerns', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    mockListIdeas.mockResolvedValue({
      ideas: [{ id: 5, title: 't', content: 'c', priority: 'low', themeId: 1 }],
      total: 1,
    });
    expect(await hasPromotableBacklog(1)).toBe(true);
  });

  test('returns false when both concerns and ideas are exhausted', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    expect(await hasPromotableBacklog(1)).toBe(false);
  });

  test('探索は開いている懸念全体から緊急を探す（バッチ先頭だけを見ない）', async () => {
    // 実測 2026-08-27: 開いている懸念43件に対しバッチは1件で、一覧は新しい順。
    // 緊急の懸念が先頭ページより後ろにあると、割り込ませるための判定から
    // 完全に見えなかった。判定は専用クエリで開いている集合全体に問う。
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 1 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockClear();
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    mockListIdeas.mockResolvedValue({ ideas: [], total: 0 });

    await promoteBacklogForTheme(1);

    const severityProbe = mockListConcerns.mock.calls
      .map((c) => c[0] as { severity?: string; limit?: number })
      .find((a) => a?.severity !== undefined);
    expect(severityProbe).toBeDefined();
    expect(severityProbe?.severity).toBe('urgent');
  });

  test('treats a rejecting listConcerns/listIdeas as empty rather than throwing', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockRejectedValue(new Error('concern query failed'));
    mockListIdeas.mockRejectedValue(new Error('idea query failed'));
    expect(await hasPromotableBacklog(1)).toBe(false);
  });

  test('returns false outside the nightly self-refill window even with open concerns/ideas (task 784)', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [{ id: 1, severity: 'high' }], total: 1 });
    mockShouldRefillBacklogNow.mockResolvedValue(false);

    expect(await hasPromotableBacklog(1)).toBe(false);
    // The gate is checked before probing concerns/ideas at all.
    expect(mockListConcerns).not.toHaveBeenCalled();
  });
});

describe('promoteBacklogForTheme — gating', () => {
  beforeEach(resetMocks);

  test('returns 0 without querying the backlog when the limit is disabled', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 0 });
    expect(await promoteBacklogForTheme(1)).toBe(0);
    expect(mockTaskCount).not.toHaveBeenCalled();
  });

  test('returns 0 when outstanding tasks already consume the whole cap', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 3 });
    mockTaskCount.mockResolvedValue(3);
    expect(await promoteBacklogForTheme(1)).toBe(0);
    expect(mockListConcerns).not.toHaveBeenCalled();
  });

  test('the outstanding-count query only counts fresh blocked tasks, not stale ones', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 3 });
    mockTaskCount.mockResolvedValue(0);
    await promoteBacklogForTheme(7);
    const [args] = mockTaskCount.mock.calls[0] as [{ where: { themeId: number; OR: unknown[] } }];
    expect(args.where.themeId).toBe(7);
    expect(args.where.OR).toHaveLength(2);
  });
});

describe('promoteBacklogForTheme — concern promotion', () => {
  beforeEach(resetMocks);

  test('promotes open concerns highest-priority-first and marks tasks auto-created', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({
      concerns: [
        { id: 10, severity: 'urgent' },
        { id: 11, severity: 'high' },
      ],
      total: 2,
    });
    mockConvertConcernToTask.mockResolvedValueOnce(501).mockResolvedValueOnce(502);

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(2);
    expect(mockConvertConcernToTask).toHaveBeenCalledTimes(2);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 501 },
      data: { autoCreatedFromBacklog: true },
    });
    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'backlog.promoted',
      expect.objectContaining({ kind: 'concern', concernId: 10, task: 501 }),
    );
    // No realized-reward stats yet → the bandit's tie breaks to 'concern' for
    // every pick, so no idea task is created while concerns remain.
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  test('stops promoting once the remaining cap hits zero mid-loop', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 1 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({
      concerns: [
        { id: 20, severity: 'high' },
        { id: 21, severity: 'medium' },
      ],
      total: 2,
    });
    mockConvertConcernToTask.mockResolvedValue(601);

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(1);
    expect(mockConvertConcernToTask).toHaveBeenCalledTimes(1);
    expect(mockConvertConcernToTask).toHaveBeenCalledWith(20);
  });

  test('a null return from convertConcernToTask (dedup/no-op) does not count as created', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [{ id: 30, severity: 'low' }], total: 1 });
    mockConvertConcernToTask.mockResolvedValue(null);

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(0);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('a throwing convertConcernToTask is caught and does not abort the loop', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({
      concerns: [
        { id: 40, severity: 'high' },
        { id: 41, severity: 'low' },
      ],
      total: 2,
    });
    mockConvertConcernToTask
      .mockRejectedValueOnce(new Error('convert failed'))
      .mockResolvedValueOnce(701);

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(1);
    expect(noopLog.warn).toHaveBeenCalled();
  });
});

describe('promoteBacklogForTheme — idea promotion', () => {
  beforeEach(resetMocks);

  test('promotes ideas when the fetched concern list is empty', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    mockListIdeas.mockResolvedValue({
      ideas: [{ id: 60, title: 'Idea title', content: 'body', priority: 'medium', themeId: 3 }],
      total: 1,
    });
    mockCreateTask.mockResolvedValue({ id: 801 });

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(1);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: '[Idea] Idea title',
        priority: 'medium',
        status: 'todo',
        themeId: 3,
      }),
    );
    expect(mockMarkIdeaAsUsed).toHaveBeenCalledWith(60, 801);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 801 },
      data: { autoCreatedFromBacklog: true },
    });
  });

  test('uncategorized (themeless) ideas are never auto-promoted', async () => {
    // NOTE: the old behavior adopted a themeless idea into the requesting theme
    // (themeId fallback). Now a human must assign a theme first — auto-run may
    // not decide which repo an uncategorized idea belongs to.
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    mockListIdeas.mockResolvedValue({
      ideas: [{ id: 61, title: 'Themeless', content: 'body', priority: 'medium', themeId: null }],
      total: 1,
    });

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(0);
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockMarkIdeaAsUsed).not.toHaveBeenCalled();
  });

  test('urgent 懸念があるとバンディットに関係なく concern が先に起票されること（安全側優先）', async () => {
    // NOTE: bandit replacement (R6) — the old "ideas only when the concern
    // backlog is fully clear" hierarchy is gone; the surviving invariant is
    // that a CRITICAL (urgent) concern always beats ideas.
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 1 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [{ id: 90, severity: 'urgent' }], total: 1 });
    mockListIdeas.mockResolvedValue({
      ideas: [{ id: 91, title: 'i', content: 'c', priority: 'high', themeId: 3 }],
      total: 1,
    });
    mockConvertConcernToTask.mockResolvedValue(950);

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(1);
    expect(mockConvertConcernToTask).toHaveBeenCalledWith(90);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  test('truncates an overlong idea title to 200 characters', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    const longTitle = 'x'.repeat(250);
    mockListIdeas.mockResolvedValue({
      ideas: [{ id: 61, title: longTitle, content: 'body', priority: 'low', themeId: 9 }],
      total: 1,
    });

    await promoteBacklogForTheme(3);

    const [, input] = mockCreateTask.mock.calls[0] as [unknown, { title: string; themeId: number }];
    expect(input.title.length).toBe(200);
    // idea.themeId is set (9), so it must win over the theme being promoted for (3).
    expect(input.themeId).toBe(9);
  });

  test('a falsy createTask result is not counted and does not mark the idea used', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    mockListIdeas.mockResolvedValue({
      ideas: [{ id: 62, title: 'x', content: 'c', priority: 'low', themeId: 1 }],
      total: 1,
    });
    mockCreateTask.mockResolvedValue(null);

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(0);
    expect(mockMarkIdeaAsUsed).not.toHaveBeenCalled();
  });

  test('a rejecting markIdeaAsUsed does not fail the promotion (best-effort)', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    mockListIdeas.mockResolvedValue({
      ideas: [{ id: 63, title: 'x', content: 'c', priority: 'low', themeId: 1 }],
      total: 1,
    });
    mockCreateTask.mockResolvedValue({ id: 802 });
    mockMarkIdeaAsUsed.mockRejectedValue(new Error('mark failed'));

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(1);
  });

  test('a throwing createTask is caught and does not abort the loop', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [], total: 0 });
    mockListIdeas.mockResolvedValue({
      ideas: [
        { id: 70, title: 'a', content: 'c', priority: 'low', themeId: 1 },
        { id: 71, title: 'b', content: 'c', priority: 'low', themeId: 1 },
      ],
      total: 2,
    });
    mockCreateTask
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({ id: 900 });

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(1);
    expect(noopLog.warn).toHaveBeenCalled();
  });
});

describe('promoteBacklogForTheme — ログ由来の懸念の再発確認', () => {
  test('24h 再発が無い log_health 懸念は resolved にしてタスク化しない', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListIdeas.mockResolvedValue({ ideas: [], total: 0 });
    mockListConcerns.mockResolvedValue({ concerns: [{ id: 40, severity: 'high' }], total: 1 });
    mockGetConcern.mockResolvedValue({
      id: 40,
      source: 'log_health',
      title: '[ログ:ERROR] Invalid `prisma.x()` invocation',
    } as never);
    mockIsLogConcernStillRecurring.mockResolvedValue(false);
    mockConvertConcernToTask.mockClear();
    mockMarkConcernResolved.mockClear();
    const created = await promoteBacklogForTheme(3);
    expect(created).toBe(0);
    expect(mockConvertConcernToTask).not.toHaveBeenCalled();
    expect(mockMarkConcernResolved).toHaveBeenCalledWith(40, true);
  });

  test('再発中（true）や不明（null）の log_health 懸念は従来どおりタスク化する', async () => {
    for (const answer of [true, null]) {
      mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
      mockTaskCount.mockResolvedValue(0);
      mockListIdeas.mockResolvedValue({ ideas: [], total: 0 });
      mockListConcerns.mockResolvedValue({ concerns: [{ id: 41, severity: 'high' }], total: 1 });
      mockGetConcern.mockResolvedValue({
        id: 41,
        source: 'log_health',
        title: '[ログ:ERROR] still happening',
      } as never);
      mockIsLogConcernStillRecurring.mockResolvedValue(answer);
      mockConvertConcernToTask.mockClear();
      mockConvertConcernToTask.mockResolvedValue(602);
      mockMarkConcernResolved.mockClear();
      const created = await promoteBacklogForTheme(3);
      expect(created).toBe(1);
      expect(mockConvertConcernToTask).toHaveBeenCalledWith(41);
      expect(mockMarkConcernResolved).not.toHaveBeenCalled();
    }
  });
});

test('source が unknown でも [ログ:] タイトルなら再発確認の対象にする（#4792 回帰）', async () => {
  mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
  mockTaskCount.mockResolvedValue(0);
  mockListIdeas.mockResolvedValue({ ideas: [], total: 0 });
  mockListConcerns.mockResolvedValue({ concerns: [{ id: 4792, severity: 'high' }], total: 1 });
  mockGetConcern.mockResolvedValue({
    id: 4792,
    source: 'unknown',
    title: '[ログ:ERROR] tauri-notification: diag: sendNotification resolved OK',
  } as never);
  mockIsLogConcernStillRecurring.mockResolvedValue(false);
  mockConvertConcernToTask.mockClear();
  mockMarkConcernResolved.mockClear();
  const created = await promoteBacklogForTheme(3);
  expect(created).toBe(0);
  expect(mockConvertConcernToTask).not.toHaveBeenCalled();
  expect(mockMarkConcernResolved).toHaveBeenCalledWith(4792, true);
});

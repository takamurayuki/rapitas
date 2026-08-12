/**
 * backlog-task-promoter.test
 *
 * Covers hasPromotableBacklog (no-op preview), promoteBacklogForTheme
 * (concern-first, idea-second promotion with the outstanding-count cap), the
 * concern value gate at the promotion boundary (computePromotableConcerns),
 * and the unmerged-repair-PR check used by the satiation verdict.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockUserSettingsFindFirst = mock(() =>
  Promise.resolve<{ autoCreateFromBacklogLimit: number } | null>(null),
);
const mockTaskCount = mock(() => Promise.resolve(0));
const mockTaskUpdate = mock(() => Promise.resolve({}));
// Quota aggregation + (real) theme-saturation pool queries; [] = no conversions
// today and no saturated theme.
const mockKnowledgeEntryFindMany = mock(() => Promise.resolve([] as Array<{ tags: string }>));
const mockGitHubPrFindMany = mock(() =>
  Promise.resolve([] as Array<{ prNumber: number; linkedTaskId: number | null }>),
);

mock.module('../../../config/database', () => ({
  prisma: {
    userSettings: { findFirst: mockUserSettingsFindFirst },
    task: { count: mockTaskCount, update: mockTaskUpdate },
    knowledgeEntry: { findMany: mockKnowledgeEntryFindMany },
    gitHubPullRequest: { findMany: mockGitHubPrFindMany },
  },
}));

const mockReadValueGateEnabled = mock(() => true);
mock.module('./value-gate-settings-store', () => ({
  readValueGateEnabled: mockReadValueGateEnabled,
  writeValueGateEnabled: mock(() => {}),
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

/** Concern fixture with the fields the value gate reads (evidence via detail's #N). */
interface TestConcern {
  id: number;
  title: string;
  detail: string;
  severity: string;
  location: string | null;
  originTaskId: number | null;
  source: string;
}

function concern(id: number, severity: string, overrides: Partial<TestConcern> = {}): TestConcern {
  return {
    id,
    severity,
    // Distinct titles so the (real) saturation gate never trips on fixtures.
    title: `フィクスチャ懸念その${id}`,
    // '#<id>' matches the task-number evidence pattern — evidenced by default.
    detail: `詳細 #${id}`,
    location: null,
    originTaskId: null,
    // Unique per-id source so the daily quota never couples unrelated fixtures.
    source: `src-${id}`,
    ...overrides,
  };
}

const mockListConcerns = mock(() => Promise.resolve({ concerns: [] as TestConcern[], total: 0 }));
const mockConvertConcernToTask = mock((_id: number) => Promise.resolve<number | null>(null));
mock.module('../../memory/concern-backlog-service', () => ({
  listConcerns: mockListConcerns,
  convertConcernToTask: mockConvertConcernToTask,
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

const {
  hasPromotableBacklog,
  promoteBacklogForTheme,
  computePromotableConcerns,
  hasUnmergedRepairPr,
} = await import('./backlog-task-promoter');

function resetMocks() {
  mockUserSettingsFindFirst.mockReset();
  mockUserSettingsFindFirst.mockResolvedValue(null);
  mockTaskCount.mockReset();
  mockTaskCount.mockResolvedValue(0);
  mockTaskUpdate.mockReset();
  mockTaskUpdate.mockResolvedValue({});
  mockKnowledgeEntryFindMany.mockReset();
  mockKnowledgeEntryFindMany.mockResolvedValue([]);
  mockGitHubPrFindMany.mockReset();
  mockGitHubPrFindMany.mockResolvedValue([]);
  mockReadValueGateEnabled.mockReset();
  mockReadValueGateEnabled.mockReturnValue(true);
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

  test('returns true when a gate-passing open concern exists', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({ concerns: [concern(1, 'high')], total: 1 });
    expect(await hasPromotableBacklog(1)).toBe(true);
    expect(mockListIdeas).not.toHaveBeenCalled();
  });

  test('returns false when the only open concerns are gate-rejected (no flap resume)', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({
      concerns: [concern(1, 'high', { detail: '証拠のない曖昧な内容' }), concern(2, 'low')],
      total: 2,
    });
    expect(await hasPromotableBacklog(1)).toBe(false);
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

  test('treats a rejecting listConcerns/listIdeas as empty rather than throwing', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 2 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockRejectedValue(new Error('concern query failed'));
    mockListIdeas.mockRejectedValue(new Error('idea query failed'));
    expect(await hasPromotableBacklog(1)).toBe(false);
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
      concerns: [concern(10, 'urgent'), concern(11, 'high')],
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
      concerns: [concern(20, 'high'), concern(21, 'medium')],
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
    mockListConcerns.mockResolvedValue({ concerns: [concern(30, 'medium')], total: 1 });
    mockConvertConcernToTask.mockResolvedValue(null);

    const created = await promoteBacklogForTheme(3);

    expect(created).toBe(0);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('a throwing convertConcernToTask is caught and does not abort the loop', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({
      concerns: [concern(40, 'high'), concern(41, 'medium')],
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
    mockListConcerns.mockResolvedValue({ concerns: [concern(90, 'urgent')], total: 1 });
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

describe('computePromotableConcerns — value gate at the promotion boundary', () => {
  beforeEach(resetMocks);

  test('returns the pass/reject split with per-concern reasons', async () => {
    const evidenced = concern(1, 'high');
    const vague = concern(2, 'high', { detail: '証拠のない曖昧な内容' });
    const low = concern(3, 'low');
    mockListConcerns.mockResolvedValue({ concerns: [evidenced, vague, low], total: 3 });

    const result = await computePromotableConcerns(1);

    expect(result.gateEnabled).toBe(true);
    expect(result.passed.map((c) => c.id)).toEqual([1]);
    expect(result.rejected).toEqual([
      { concern: vague, reason: 'no_evidence' },
      { concern: low, reason: 'below_severity' },
    ]);
  });

  test('gate-rejected concerns are never converted by promoteBacklogForTheme', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoCreateFromBacklogLimit: 5 });
    mockTaskCount.mockResolvedValue(0);
    mockListConcerns.mockResolvedValue({
      concerns: [concern(1, 'high'), concern(2, 'high', { detail: '証拠のない曖昧な内容' })],
      total: 2,
    });
    mockConvertConcernToTask.mockResolvedValue(501);

    const created = await promoteBacklogForTheme(1);

    expect(created).toBe(1);
    expect(mockConvertConcernToTask).toHaveBeenCalledTimes(1);
    expect(mockConvertConcernToTask).toHaveBeenCalledWith(1);
  });

  test("the source daily quota counts today's conversions from KnowledgeEntry tags", async () => {
    // 2 log_health conversions already today → a 3rd log_health concern is
    // quota-rejected while a different source still passes.
    mockKnowledgeEntryFindMany.mockResolvedValue([
      { tags: JSON.stringify(['severity:high', 'source:log_health']) },
      { tags: JSON.stringify(['severity:high', 'source:log_health']) },
    ]);
    mockListConcerns.mockResolvedValue({
      concerns: [
        concern(1, 'high', { source: 'log_health' }),
        concern(2, 'high', { source: 'ci_watch' }),
      ],
      total: 2,
    });

    const result = await computePromotableConcerns(1);

    expect(result.passed.map((c) => c.id)).toEqual([2]);
    expect(result.rejected).toEqual([
      { concern: expect.objectContaining({ id: 1 }), reason: 'source_quota' },
    ]);
  });

  test('a failing quota aggregation is fail-open (concerns still pass)', async () => {
    mockKnowledgeEntryFindMany.mockRejectedValue(new Error('db down'));
    mockListConcerns.mockResolvedValue({ concerns: [concern(1, 'high')], total: 1 });

    const result = await computePromotableConcerns(1);

    expect(result.passed).toHaveLength(1);
    expect(noopLog.warn).toHaveBeenCalled();
  });

  test('toggle OFF passes every concern through unchanged (旧挙動)', async () => {
    mockReadValueGateEnabled.mockReturnValue(false);
    mockListConcerns.mockResolvedValue({
      concerns: [concern(1, 'low', { detail: '証拠のない曖昧な内容' })],
      total: 1,
    });

    const result = await computePromotableConcerns(1);

    expect(result.gateEnabled).toBe(false);
    expect(result.passed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    // Quota aggregation is skipped entirely when the gate is off.
    expect(mockKnowledgeEntryFindMany).not.toHaveBeenCalled();
  });
});

describe('hasUnmergedRepairPr', () => {
  beforeEach(resetMocks);

  test('false when there are no open PR rows', async () => {
    expect(await hasUnmergedRepairPr(1)).toBe(false);
    expect(mockTaskCount).not.toHaveBeenCalled();
  });

  test('true when an open PR is linkedTaskId-linked to a theme task', async () => {
    mockGitHubPrFindMany.mockResolvedValue([{ prNumber: 300, linkedTaskId: 55 }]);
    mockTaskCount.mockResolvedValue(1);
    expect(await hasUnmergedRepairPr(1)).toBe(true);
  });

  test('true via the Task.githubPrId (PR number) fallback when linkedTaskId is null', async () => {
    mockGitHubPrFindMany.mockResolvedValue([{ prNumber: 301, linkedTaskId: null }]);
    // First count call would be skipped (no linked ids); the fallback count hits.
    mockTaskCount.mockResolvedValue(1);
    expect(await hasUnmergedRepairPr(1)).toBe(true);
    const [args] = mockTaskCount.mock.calls[0] as [
      { where: { themeId: number; githubPrId: { in: number[] } } },
    ];
    expect(args.where.githubPrId.in).toEqual([301]);
  });

  test('false when open PRs belong to other themes', async () => {
    mockGitHubPrFindMany.mockResolvedValue([{ prNumber: 302, linkedTaskId: 60 }]);
    mockTaskCount.mockResolvedValue(0);
    expect(await hasUnmergedRepairPr(1)).toBe(false);
  });

  test('a DB error is fail-open (reports no repair PR)', async () => {
    mockGitHubPrFindMany.mockRejectedValue(new Error('db down'));
    expect(await hasUnmergedRepairPr(1)).toBe(false);
    expect(noopLog.warn).toHaveBeenCalled();
  });
});

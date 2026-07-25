/**
 * concern-backlog-service.test
 *
 * Tests for the concern backlog service:
 * - Pure coercion helpers (normalizeConcernType, normalizeConcernSeverity)
 * - DB-backed functions (markConcernResolved, getConcern, listConcerns,
 *   getConcernStats) with prisma mocked
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock declarations are hoisted by bun before static imports.
const mockKnowledgeEntryFindFirst = mock(() => Promise.resolve(null));
const mockKnowledgeEntryFindMany = mock(() => Promise.resolve([]));
const mockKnowledgeEntryCount = mock(() => Promise.resolve(0));
const mockKnowledgeEntryGroupBy = mock(() => Promise.resolve([]));
const mockKnowledgeEntryUpdate = mock(() => Promise.resolve({}));
const mockKnowledgeEntryCreate = mock(() => Promise.resolve({ id: 1 }));

const mockGitHubIssueFindMany = mock(() => Promise.resolve([]));
const mockThemeFindFirst = mock(() => Promise.resolve(null));
// theme-resolution.ts's resolveDefaultThemeId reads ALL themes via findMany
// (working-dir-aware ranking), not the single-row findFirst the old local
// concern-backlog-service implementation used.
const mockThemeFindMany = mock(() => Promise.resolve([] as Record<string, unknown>[]));
const mockTaskFindUnique = mock(() => Promise.resolve(null as Record<string, unknown> | null));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    knowledgeEntry: {
      findFirst: mockKnowledgeEntryFindFirst,
      findMany: mockKnowledgeEntryFindMany,
      count: mockKnowledgeEntryCount,
      groupBy: mockKnowledgeEntryGroupBy,
      update: mockKnowledgeEntryUpdate,
      create: mockKnowledgeEntryCreate,
    },
    gitHubIssue: {
      findMany: mockGitHubIssueFindMany,
    },
    theme: {
      findFirst: mockThemeFindFirst,
      findMany: mockThemeFindMany,
    },
    task: {
      findUnique: mockTaskFindUnique,
    },
  },
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));

mock.module('../task/task-mutations', () => ({
  createTask: mock(() => Promise.resolve({ id: 100 })),
}));

const {
  CONCERN_TYPES,
  CONCERN_SEVERITIES,
  normalizeConcernType,
  normalizeConcernSeverity,
  markConcernResolved,
  getConcern,
  listConcerns,
  getConcernStats,
  submitConcern,
} = await import('./concern-backlog-service');

const { isConcernType, isConcernSeverity } =
  await import('./concern-backlog-service.guards.generated');

// ─── Reset helper ──────────────────────────────────────────────────────────────

function resetMocks() {
  mockKnowledgeEntryFindFirst.mockReset().mockResolvedValue(null);
  mockKnowledgeEntryFindMany.mockReset().mockResolvedValue([]);
  mockKnowledgeEntryCount.mockReset().mockResolvedValue(0);
  mockKnowledgeEntryGroupBy.mockReset().mockResolvedValue([]);
  mockKnowledgeEntryUpdate.mockReset().mockResolvedValue({});
  mockKnowledgeEntryCreate.mockReset().mockResolvedValue({ id: 1 });
  mockGitHubIssueFindMany.mockReset().mockResolvedValue([]);
  mockThemeFindFirst.mockReset().mockResolvedValue(null);
  mockThemeFindMany.mockReset().mockResolvedValue([]);
  mockTaskFindUnique.mockReset().mockResolvedValue(null);
}

// ─── Pure helper tests ────────────────────────────────────────────────────────

describe('normalizeConcernType', () => {
  it.each(['bug', 'refactor', 'security', 'perf', 'other'] as const)(
    'accepts valid type "%s"',
    (t: 'bug' | 'refactor' | 'security' | 'perf' | 'other') =>
      expect(normalizeConcernType(t)).toBe(t),
  );

  it.each([
    { name: 'unknown string to "bug"', input: 'unknown' },
    { name: 'undefined to "bug"', input: undefined },
    { name: 'null to "bug"', input: null },
  ])('defaults $name', ({ input }) => {
    expect(normalizeConcernType(input)).toBe('bug');
  });
});

describe('normalizeConcernSeverity', () => {
  it.each(['urgent', 'high', 'medium', 'low'] as const)(
    'accepts valid severity "%s"',
    (s: 'urgent' | 'high' | 'medium' | 'low') => expect(normalizeConcernSeverity(s)).toBe(s),
  );

  it('defaults unknown string to "medium"', () => {
    expect(normalizeConcernSeverity('critical')).toBe('medium');
  });

  it('defaults undefined to "medium"', () => {
    expect(normalizeConcernSeverity(undefined)).toBe('medium');
  });
});

// ─── markConcernResolved ──────────────────────────────────────────────────────

describe('markConcernResolved', () => {
  beforeEach(resetMocks);

  it('open → resolved: update を呼んで true を返す', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue({ id: 1, sourceId: 'open' });

    const result = await markConcernResolved(1, true);

    expect(result).toBe(true);
    expect(mockKnowledgeEntryUpdate).toHaveBeenCalledTimes(1);
    const call = mockKnowledgeEntryUpdate.mock.calls[0][0];
    expect(call.data.sourceId).toBe('resolved');
  });

  it('resolved → open: update を呼んで true を返す', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue({ id: 1, sourceId: 'resolved' });

    const result = await markConcernResolved(1, false);

    expect(result).toBe(true);
    const call = mockKnowledgeEntryUpdate.mock.calls[0][0];
    expect(call.data.sourceId).toBe('open');
  });

  it('dismissed の concern は変更しない (false を返す)', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue({ id: 1, sourceId: 'dismissed' });

    const result = await markConcernResolved(1, true);

    expect(result).toBe(false);
    expect(mockKnowledgeEntryUpdate).not.toHaveBeenCalled();
  });

  it('task_created の concern は変更しない (false を返す)', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue({ id: 1, sourceId: 'task_42' });

    const result = await markConcernResolved(1, true);

    expect(result).toBe(false);
    expect(mockKnowledgeEntryUpdate).not.toHaveBeenCalled();
  });

  it('open → open (resolved=false): ガードに引っかかり false を返す', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue({ id: 1, sourceId: 'open' });

    const result = await markConcernResolved(1, false);

    expect(result).toBe(false);
    expect(mockKnowledgeEntryUpdate).not.toHaveBeenCalled();
  });

  it('concern が見つからない場合は false を返す', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue(null);

    const result = await markConcernResolved(999, true);

    expect(result).toBe(false);
    expect(mockKnowledgeEntryUpdate).not.toHaveBeenCalled();
  });
});

// ─── submitConcern — theme attribution ─────────────────────────────────────────

describe('submitConcern — theme attribution', () => {
  beforeEach(resetMocks);

  // Regression: submitConcern used to store `input.themeId ?? null` verbatim —
  // any caller that omitted themeId (verification-gate.ts's pre-existing-
  // failure filing, the public POST /concerns route, GitHub issue import) left
  // the concern permanently theme-less, even when originTaskId was present and
  // resolvable. Mirrors submitIdea's same invariant (idea-box-service.ts).

  it('uses the explicit themeId when provided, without looking up the task', async () => {
    await submitConcern({ title: 'タイトルが十分な長さの懸念', detail: '詳細', themeId: 7 });

    expect(mockKnowledgeEntryCreate).toHaveBeenCalledTimes(1);
    const call = mockKnowledgeEntryCreate.mock.calls[0][0] as { data: { themeId: number | null } };
    expect(call.data.themeId).toBe(7);
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });

  it('resolves themeId from originTaskId when themeId is omitted', async () => {
    mockTaskFindUnique.mockResolvedValue({ themeId: 12, workingDirectory: null });

    await submitConcern({ title: 'タイトルが十分な長さの懸念', detail: '詳細', originTaskId: 511 });

    expect(mockTaskFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 511 } }),
    );
    const call = mockKnowledgeEntryCreate.mock.calls[0][0] as { data: { themeId: number | null } };
    expect(call.data.themeId).toBe(12);
  });

  it('falls back to the default theme when originTaskId has no theme of its own', async () => {
    mockTaskFindUnique.mockResolvedValue({ themeId: null, workingDirectory: null });
    mockThemeFindMany.mockResolvedValue([{ id: 3, isDefault: true, workingDirectory: null }]);

    await submitConcern({ title: 'タイトルが十分な長さの懸念', detail: '詳細', originTaskId: 511 });

    const call = mockKnowledgeEntryCreate.mock.calls[0][0] as { data: { themeId: number | null } };
    expect(call.data.themeId).toBe(3);
  });

  it('falls back to the default theme when neither themeId nor originTaskId is given', async () => {
    mockThemeFindMany.mockResolvedValue([{ id: 9, isDefault: true, workingDirectory: null }]);

    await submitConcern({ title: 'タイトルが十分な長さの懸念', detail: '詳細' });

    expect(mockTaskFindUnique).not.toHaveBeenCalled();
    const call = mockKnowledgeEntryCreate.mock.calls[0][0] as { data: { themeId: number | null } };
    expect(call.data.themeId).toBe(9);
  });

  it('stores themeId: null only when genuinely no theme exists at all', async () => {
    mockThemeFindMany.mockResolvedValue([]);

    await submitConcern({ title: 'タイトルが十分な長さの懸念', detail: '詳細' });

    const call = mockKnowledgeEntryCreate.mock.calls[0][0] as { data: { themeId: number | null } };
    expect(call.data.themeId).toBeNull();
  });
});

// ─── getConcern ───────────────────────────────────────────────────────────────

describe('getConcern', () => {
  const CONCERN_ROW = {
    id: 1,
    title: 'Auth flaw',
    content: 'JWT not validated',
    category: 'security',
    tags: '["severity:high","loc:src/auth.ts"]',
    sourceId: 'open',
    themeId: null,
    taskId: null,
    createdAt: new Date(),
  };

  beforeEach(resetMocks);

  it('concern が見つかる: 正しくマッピングされた ConcernEntry を返す', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue(CONCERN_ROW);
    mockGitHubIssueFindMany.mockResolvedValue([]);

    const concern = await getConcern(1);

    expect(concern).not.toBeNull();
    expect(concern!.id).toBe(1);
    expect(concern!.type).toBe('security');
    expect(concern!.severity).toBe('high');
    expect(concern!.location).toBe('src/auth.ts');
    expect(concern!.status).toBe('open');
    expect(concern!.linkedIssue).toBeNull();
  });

  it('linkedIssue を enrich して返す', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue(CONCERN_ROW);
    mockGitHubIssueFindMany.mockResolvedValue([
      {
        id: 10,
        issueNumber: 42,
        url: 'https://github.com/t/r/issues/42',
        state: 'open',
        linkedConcernId: 1,
      },
    ]);

    const concern = await getConcern(1);

    expect(concern!.linkedIssue).not.toBeNull();
    expect(concern!.linkedIssue!.issueNumber).toBe(42);
    expect(concern!.linkedIssue!.state).toBe('open');
  });

  it('存在しない場合は null を返す', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue(null);

    const result = await getConcern(999);

    expect(result).toBeNull();
  });

  it('sourceId="resolved" の行を status="resolved" にマッピングする', async () => {
    mockKnowledgeEntryFindFirst.mockResolvedValue({ ...CONCERN_ROW, sourceId: 'resolved' });
    mockGitHubIssueFindMany.mockResolvedValue([]);

    const concern = await getConcern(1);

    expect(concern!.status).toBe('resolved');
  });
});

// ─── listConcerns ─────────────────────────────────────────────────────────────

describe('listConcerns', () => {
  const CONCERN_ROW = {
    id: 2,
    title: 'DB index missing',
    content: 'Slow query on users table',
    category: 'perf',
    tags: '["severity:medium"]',
    sourceId: 'resolved',
    themeId: null,
    taskId: null,
    createdAt: new Date(),
  };

  beforeEach(resetMocks);

  it('status=resolved フィルタが sourceId="resolved" として where に渡される', async () => {
    mockKnowledgeEntryFindMany.mockResolvedValue([]);
    mockKnowledgeEntryCount.mockResolvedValue(0);

    await listConcerns({ status: 'resolved' });

    const call = mockKnowledgeEntryFindMany.mock.calls[0][0];
    expect(call.where.sourceId).toBe('resolved');
  });

  it('linkedIssue enrich: 結果に linkedIssue が付与される', async () => {
    mockKnowledgeEntryFindMany.mockResolvedValue([CONCERN_ROW]);
    mockKnowledgeEntryCount.mockResolvedValue(1);
    mockGitHubIssueFindMany.mockResolvedValue([
      {
        id: 20,
        issueNumber: 7,
        url: 'https://github.com/t/r/issues/7',
        state: 'closed',
        linkedConcernId: 2,
      },
    ]);

    const { concerns, total } = await listConcerns({ status: 'all' });

    expect(total).toBe(1);
    expect(concerns[0].linkedIssue).not.toBeNull();
    expect(concerns[0].linkedIssue!.issueNumber).toBe(7);
    expect(concerns[0].linkedIssue!.state).toBe('closed');
  });

  it('sourceId="resolved" の concern を status="resolved" に変換する', async () => {
    mockKnowledgeEntryFindMany.mockResolvedValue([CONCERN_ROW]);
    mockKnowledgeEntryCount.mockResolvedValue(1);

    const { concerns } = await listConcerns({ status: 'resolved' });

    expect(concerns[0].status).toBe('resolved');
  });

  it('linkedIssue がない concern は linkedIssue=null になる', async () => {
    mockKnowledgeEntryFindMany.mockResolvedValue([CONCERN_ROW]);
    mockKnowledgeEntryCount.mockResolvedValue(1);
    mockGitHubIssueFindMany.mockResolvedValue([]);

    const { concerns } = await listConcerns({ status: 'all' });

    expect(concerns[0].linkedIssue).toBeNull();
  });
});

// ─── getConcernStats ──────────────────────────────────────────────────────────

describe('getConcernStats', () => {
  beforeEach(resetMocks);

  it('resolved カウントが統計に含まれる', async () => {
    mockKnowledgeEntryCount
      .mockResolvedValueOnce(5) // open
      .mockResolvedValueOnce(2) // task_created
      .mockResolvedValueOnce(1) // dismissed
      .mockResolvedValueOnce(3); // resolved
    mockKnowledgeEntryGroupBy.mockResolvedValue([
      { category: 'bug', _count: { id: 3 } },
      { category: 'security', _count: { id: 2 } },
    ]);

    const stats = await getConcernStats();

    expect(stats.open).toBe(5);
    expect(stats.taskCreated).toBe(2);
    expect(stats.dismissed).toBe(1);
    expect(stats.resolved).toBe(3);
    expect(stats.byType).toHaveLength(2);
    expect(stats.byType[0]).toEqual({ type: 'bug', count: 3 });
    expect(stats.byType[1]).toEqual({ type: 'security', count: 2 });
  });

  it('全ゼロの場合も正しく返す', async () => {
    mockKnowledgeEntryCount.mockResolvedValue(0);
    mockKnowledgeEntryGroupBy.mockResolvedValue([]);

    const stats = await getConcernStats();

    expect(stats.open).toBe(0);
    expect(stats.resolved).toBe(0);
    expect(stats.byType).toHaveLength(0);
  });
});

// ─── SSOT 配列テスト ──────────────────────────────────────────────────────────

describe('CONCERN_TYPES (SSOT array)', () => {
  it('contains all expected concern type strings', () => {
    expect(CONCERN_TYPES).toEqual(['bug', 'refactor', 'security', 'perf', 'other']);
  });
});

describe('CONCERN_SEVERITIES (SSOT array)', () => {
  it('contains all expected severity strings', () => {
    expect(CONCERN_SEVERITIES).toEqual(['urgent', 'high', 'medium', 'low']);
  });
});

describe('isConcernType (generated guard)', () => {
  it.each(['bug', 'refactor', 'security', 'perf', 'other'] as const)(
    'returns true for valid type "%s"',
    (t) => {
      expect(isConcernType(t)).toBe(true);
    },
  );

  it('returns false for invalid string', () => {
    expect(isConcernType('critical')).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isConcernType(null)).toBe(false);
    expect(isConcernType(undefined)).toBe(false);
  });
});

describe('isConcernSeverity (generated guard)', () => {
  it.each(['urgent', 'high', 'medium', 'low'] as const)(
    'returns true for valid severity "%s"',
    (s) => {
      expect(isConcernSeverity(s)).toBe(true);
    },
  );

  it('returns false for invalid string', () => {
    expect(isConcernSeverity('critical')).toBe(false);
  });
});

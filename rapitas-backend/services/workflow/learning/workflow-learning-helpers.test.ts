/**
 * workflow-learning-helpers.test.ts
 *
 * Covers the four pure functions (calculatePhaseTimings, extractKeywords,
 * detectSkippedPhases, matchesCondition) with no mocking required, plus the
 * two Prisma-backed persistence helpers (upsertRule, deactivateStaleRules)
 * against a mocked `config` barrel.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { RuleGenerationResult } from './workflow-learning-helpers';

const mockFindFirst = mock(() => Promise.resolve<{ id: number } | null>(null));
const mockUpdate = mock(() => Promise.resolve({}));
const mockCreate = mock(() => Promise.resolve({}));
const mockUpdateMany = mock(() => Promise.resolve({ count: 0 }));

// NOTE: mirrors every runtime export of config/index.ts (the barrel this file
// imports `prisma` from) — mock.module is process-global, so a partial mock
// would break any other test file that imports the untouched exports later
// in the same bun test run.
mock.module('../../../config', () => ({
  prisma: {
    workflowOptimizationRule: {
      findFirst: mockFindFirst,
      update: mockUpdate,
      create: mockCreate,
      updateMany: mockUpdateMany,
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    fatal() {},
  }),
  logger: { info() {}, warn() {}, error() {}, debug() {}, fatal() {} },
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => process.cwd(),
}));

const {
  calculatePhaseTimings,
  extractKeywords,
  detectSkippedPhases,
  matchesCondition,
  upsertRule,
  deactivateStaleRules,
} = await import('./workflow-learning-helpers');

function freshResult(): RuleGenerationResult {
  return { rulesCreated: 0, rulesUpdated: 0, rulesDeactivated: 0, details: [] };
}

beforeEach(() => {
  mockFindFirst.mockReset().mockResolvedValue(null);
  mockUpdate.mockReset().mockResolvedValue({});
  mockCreate.mockReset().mockResolvedValue({});
  mockUpdateMany.mockReset().mockResolvedValue({ count: 0 });
});

// ───────────────────────────────────────────────
// calculatePhaseTimings
// ───────────────────────────────────────────────

describe('calculatePhaseTimings', () => {
  const base = new Date('2024-01-01T00:00:00Z');
  const at = (minutes: number) => new Date(base.getTime() + minutes * 60000);

  test('empty activity log returns an empty timings object', () => {
    expect(calculatePhaseTimings([], base)).toEqual({});
  });

  test('non-status-change actions are ignored entirely', () => {
    const logs = [{ action: 'comment_added', createdAt: at(5), metadata: null }];
    expect(calculatePhaseTimings(logs, base)).toEqual({});
  });

  test('derives research/plan/implement/verify durations from ordered transitions', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        createdAt: at(10),
        metadata: JSON.stringify({ newStatus: 'research_done' }),
      },
      {
        action: 'workflow_status_updated',
        createdAt: at(25),
        metadata: JSON.stringify({ newStatus: 'plan_created' }),
      },
      {
        action: 'workflow_status_updated',
        createdAt: at(70),
        metadata: JSON.stringify({ newStatus: 'in_progress' }),
      },
      {
        action: 'workflow_status_updated',
        createdAt: at(100),
        metadata: JSON.stringify({ newStatus: 'completed' }),
      },
    ];
    expect(calculatePhaseTimings(logs, base)).toEqual({
      research: 10,
      plan: 15,
      implement: 45,
      verify: 30,
    });
  });

  test('input order does not matter — entries are sorted by createdAt first', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        createdAt: at(25),
        metadata: JSON.stringify({ newStatus: 'plan_created' }),
      },
      {
        action: 'workflow_status_updated',
        createdAt: at(10),
        metadata: JSON.stringify({ newStatus: 'research_done' }),
      },
    ];
    expect(calculatePhaseTimings(logs, base)).toEqual({ research: 10, plan: 15 });
  });

  test('null metadata falls back to the action name as newStatus', () => {
    const logs = [{ action: 'plan_approved', createdAt: at(12), metadata: null }];
    expect(calculatePhaseTimings(logs, base)).toEqual({ plan: 12 });
  });

  test('"research" (not just "research_done") is recognized', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        createdAt: at(8),
        metadata: JSON.stringify({ newStatus: 'research' }),
      },
    ];
    expect(calculatePhaseTimings(logs, base)).toEqual({ research: 8 });
  });

  test('"verify_done" maps to the verify phase like "completed"', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        createdAt: at(20),
        metadata: JSON.stringify({ newStatus: 'verify_done' }),
      },
    ];
    expect(calculatePhaseTimings(logs, base)).toEqual({ verify: 20 });
  });

  test('an unrecognized newStatus advances the timestamp baseline without recording a phase', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        createdAt: at(30),
        metadata: JSON.stringify({ newStatus: 'some_other_status' }),
      },
      {
        action: 'workflow_status_updated',
        createdAt: at(40),
        metadata: JSON.stringify({ newStatus: 'plan_created' }),
      },
    ];
    // plan duration is measured from the unrecognized transition (30), not task creation.
    expect(calculatePhaseTimings(logs, base)).toEqual({ plan: 10 });
  });
});

// ───────────────────────────────────────────────
// extractKeywords
// ───────────────────────────────────────────────

describe('extractKeywords', () => {
  test('lowercases, splits on whitespace, and drops English stop-words', () => {
    expect(extractKeywords('Fix the login bug in auth module')).toEqual([
      'fix',
      'login',
      'bug',
      'auth',
      'module',
    ]);
  });

  test('a title made entirely of stop-words yields no keywords', () => {
    expect(extractKeywords('a an the is')).toEqual([]);
  });

  test('single-character tokens are dropped regardless of stop-word status', () => {
    expect(extractKeywords('a b c dog')).toEqual(['dog']);
  });

  test('caps the result at 10 keywords', () => {
    const title = 'foo-bar_baz/qux:corge;grault,garply.waldo(fred)[plugh]{xyzzy}';
    const result = extractKeywords(title);
    expect(result).toHaveLength(10);
    expect(result).not.toContain('xyzzy');
  });

  test('Japanese particles are stripped as stop-words', () => {
    expect(extractKeywords('これ の テスト を する')).toEqual(['これ', 'テスト']);
  });

  test('empty string returns an empty array', () => {
    expect(extractKeywords('')).toEqual([]);
  });
});

// ───────────────────────────────────────────────
// detectSkippedPhases
// ───────────────────────────────────────────────

describe('detectSkippedPhases', () => {
  test('lightweight mode never reports skipped phases', () => {
    expect(detectSkippedPhases('lightweight', [])).toEqual([]);
  });

  test('comprehensive mode with no status history reports both phases skipped', () => {
    expect(detectSkippedPhases('comprehensive', [])).toEqual(['research', 'plan']);
  });

  test('standard mode: research_done present but no plan status → only plan skipped', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        metadata: JSON.stringify({ newStatus: 'research_done' }),
      },
    ];
    expect(detectSkippedPhases('standard', logs)).toEqual(['plan']);
  });

  test('plan_approved (not just plan_created) counts as plan having run', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        metadata: JSON.stringify({ newStatus: 'research_done' }),
      },
      {
        action: 'workflow_status_updated',
        metadata: JSON.stringify({ newStatus: 'plan_approved' }),
      },
    ];
    expect(detectSkippedPhases('comprehensive', logs)).toEqual([]);
  });

  test('previousStatus alone is enough to mark a phase as having occurred', () => {
    const logs = [
      {
        action: 'workflow_status_updated',
        metadata: JSON.stringify({ previousStatus: 'research_done' }),
      },
    ];
    expect(detectSkippedPhases('comprehensive', logs)).toEqual(['plan']);
  });

  test('malformed metadata JSON is ignored rather than throwing', () => {
    const logs = [{ action: 'workflow_status_updated', metadata: '{not valid json' }];
    expect(() => detectSkippedPhases('comprehensive', logs)).not.toThrow();
    expect(detectSkippedPhases('comprehensive', logs)).toEqual(['research', 'plan']);
  });

  test('null metadata entries are skipped gracefully', () => {
    const logs = [{ action: 'workflow_status_updated', metadata: null }];
    expect(detectSkippedPhases('standard', logs)).toEqual(['research', 'plan']);
  });
});

// ───────────────────────────────────────────────
// matchesCondition
// ───────────────────────────────────────────────

describe('matchesCondition', () => {
  const task = { themeId: 5, workflowMode: 'comprehensive' as string | null };

  test('an empty condition matches vacuously', () => {
    expect(matchesCondition({}, task, 40)).toBe(true);
  });

  test('themeId clause: matches when equal, fails when different', () => {
    expect(matchesCondition({ themeId: 5 }, task, 40)).toBe(true);
    expect(matchesCondition({ themeId: 6 }, task, 40)).toBe(false);
  });

  test('themeId clause explicitly null matches a task with themeId null', () => {
    expect(matchesCondition({ themeId: null }, { ...task, themeId: null }, 40)).toBe(true);
  });

  test('predictedComplexityBelow: boundary value is inclusive (pass), one above fails', () => {
    expect(matchesCondition({ predictedComplexityBelow: 50 }, task, 50)).toBe(true);
    expect(matchesCondition({ predictedComplexityBelow: 50 }, task, 51)).toBe(false);
  });

  test('originalMode clause: matches when equal, fails when different or null', () => {
    expect(matchesCondition({ originalMode: 'comprehensive' }, task, 40)).toBe(true);
    expect(matchesCondition({ originalMode: 'standard' }, task, 40)).toBe(false);
    expect(
      matchesCondition({ originalMode: 'comprehensive' }, { ...task, workflowMode: null }, 40),
    ).toBe(false);
  });

  test('all clauses must pass — a single failing clause fails the whole match', () => {
    const condition = { themeId: 5, predictedComplexityBelow: 50, originalMode: 'standard' };
    expect(matchesCondition(condition, task, 40)).toBe(false);
  });
});

// ───────────────────────────────────────────────
// upsertRule
// ───────────────────────────────────────────────

describe('upsertRule', () => {
  test('updates an existing active rule and records the outcome', async () => {
    mockFindFirst.mockResolvedValue({ id: 42 });
    const result = freshResult();

    await upsertRule('downgrade_mode', '{"a":1}', '{"b":2}', 0.9, 12, '説明文', result);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0] as {
      where: { id: number };
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: 42 });
    expect(call.data).toMatchObject({
      recommendation: '{"b":2}',
      confidence: 0.9,
      sampleSize: 12,
      successRate: 0.9,
      description: '説明文',
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.rulesUpdated).toBe(1);
    expect(result.rulesCreated).toBe(0);
    expect(result.details).toEqual(['ルール更新: 説明文']);
  });

  test('creates a new rule when no active match exists', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = freshResult();

    await upsertRule('skip_phase', '{"a":1}', '{"b":2}', 0.87, 6, '新規ルール', result);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      ruleType: 'skip_phase',
      condition: '{"a":1}',
      recommendation: '{"b":2}',
      confidence: 0.87,
      sampleSize: 6,
      successRate: 0.87,
      description: '新規ルール',
      isActive: true,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.rulesCreated).toBe(1);
    expect(result.rulesUpdated).toBe(0);
    expect(result.details).toEqual(['ルール作成: 新規ルール']);
  });
});

// ───────────────────────────────────────────────
// deactivateStaleRules
// ───────────────────────────────────────────────

describe('deactivateStaleRules', () => {
  test('records the deactivation count and detail message when rules were deactivated', async () => {
    mockUpdateMany.mockResolvedValue({ count: 3 });
    const result = freshResult();

    await deactivateStaleRules(result);

    expect(result.rulesDeactivated).toBe(3);
    expect(result.details).toEqual(['3件の古いルールを非活性化']);
    const call = mockUpdateMany.mock.calls[0][0] as {
      where: { isActive: boolean; lastEvaluated: { lt: Date } };
      data: { isActive: boolean };
    };
    expect(call.where.isActive).toBe(true);
    expect(call.where.lastEvaluated.lt).toBeInstanceOf(Date);
    expect(call.data).toEqual({ isActive: false });
  });

  test('leaves the result untouched when no rules were stale', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const result = freshResult();

    await deactivateStaleRules(result);

    expect(result.rulesDeactivated).toBe(0);
    expect(result.details).toEqual([]);
  });
});

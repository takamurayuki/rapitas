/**
 * role-evidence unit tests
 *
 * Verifies proven-tier resolution from recorded outcomes: sample/success
 * thresholds, cheapest-tier-wins ordering, the RAPITAS_EVIDENCE_ROUTING kill
 * switch, null-model exclusion, the per-role TTL cache, gate-rejection
 * attribution (incl. researcher/planner critic bounces), and the dual
 * 45-day / recent-14-day window proven check.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const findMany = mock(() => Promise.resolve([] as unknown[]));
const transitionFindMany = mock(() => Promise.resolve([] as Array<{ taskId: number }>));
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: { findMany },
    workflowTransition: { findMany: transitionFindMany },
  },
}));

import { getRoleModelOutcomes, resolveProvenTier, _resetProvenTierCache } from './role-evidence';

/** Build n outcome rows for a model, `fails` of which are failures. */
function rows(modelName: string, n: number, fails = 0): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    status: i < fails ? 'failed' : 'completed',
    errorMessage: null,
    modelName,
  }));
}

beforeEach(() => {
  _resetProvenTierCache();
  findMany.mockReset();
  findMany.mockImplementation(() => Promise.resolve([]));
  transitionFindMany.mockReset();
  transitionFindMany.mockImplementation(() => Promise.resolve([]));
  delete process.env.RAPITAS_EVIDENCE_ROUTING;
  delete process.env.RAPITAS_EVIDENCE_MIN_SAMPLES;
  delete process.env.RAPITAS_EVIDENCE_MIN_SUCCESS;
});

afterEach(() => {
  delete process.env.RAPITAS_EVIDENCE_ROUTING;
  delete process.env.RAPITAS_EVIDENCE_MIN_SAMPLES;
  delete process.env.RAPITAS_EVIDENCE_MIN_SUCCESS;
});

describe('getRoleModelOutcomes', () => {
  test('aggregates per-model samples, successes, rate, and tier', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        ...rows('claude-haiku-4-5-20251001', 10, 1),
        ...rows('claude-sonnet-4-6', 4),
      ]),
    );

    const outcomes = await getRoleModelOutcomes('implementer');
    expect(outcomes).toHaveLength(2);
    const haiku = outcomes[0]; // most-sampled first
    expect(haiku.modelName).toBe('claude-haiku-4-5-20251001');
    expect(haiku.tier).toBe('economy');
    expect(haiku.samples).toBe(10);
    expect(haiku.successes).toBe(9);
    expect(haiku.successRate).toBeCloseTo(0.9);
    expect(outcomes[1].tier).toBe('standard');
  });

  test('counts an errorMessage row as a failure even when status=completed', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        { status: 'completed', errorMessage: 'boom', modelName: 'claude-haiku-4-5-20251001' },
      ]),
    );
    const outcomes = await getRoleModelOutcomes('verifier');
    expect(outcomes[0].successes).toBe(0);
  });
});

describe('resolveProvenTier', () => {
  test('returns the tier of a model with enough high-success samples', async () => {
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 10)));
    expect(await resolveProvenTier('implementer')).toBe('economy');
  });

  test('returns undefined below the sample threshold', async () => {
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 7)));
    expect(await resolveProvenTier('planner')).toBeUndefined();
  });

  test('returns undefined below the success-rate threshold', async () => {
    // 8 samples, 2 failures → 75% < 90%
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 8, 2)));
    expect(await resolveProvenTier('implementer')).toBeUndefined();
  });

  test('picks the CHEAPEST proven tier when several qualify', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([...rows('claude-sonnet-4-6', 20), ...rows('claude-haiku-4-5-20251001', 10)]),
    );
    expect(await resolveProvenTier('implementer')).toBe('economy');
  });

  test('kill switch RAPITAS_EVIDENCE_ROUTING=0 disables resolution', async () => {
    process.env.RAPITAS_EVIDENCE_ROUTING = '0';
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 20)));
    expect(await resolveProvenTier('implementer')).toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  test('thresholds are tunable via env', async () => {
    process.env.RAPITAS_EVIDENCE_MIN_SAMPLES = '5';
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 5)));
    expect(await resolveProvenTier('planner')).toBe('economy');
  });

  test('caches per role until reset (single DB query for repeat calls)', async () => {
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 10)));
    await resolveProvenTier('implementer');
    await resolveProvenTier('implementer');
    expect(findMany).toHaveBeenCalledTimes(1);
    _resetProvenTierCache();
    await resolveProvenTier('implementer');
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});

describe('getRoleModelOutcomes — gate-rejection aware success (実装の差し戻し反映)', () => {
  /** Rows carrying a taskId via the session relation. */
  function rowsWithTask(modelName: string, taskIds: number[]): unknown[] {
    return taskIds.map((taskId) => ({
      status: 'completed',
      errorMessage: null,
      modelName,
      session: { config: { taskId } },
    }));
  }

  test('implementer: verify差し戻しのあったタスクの実行は成功に数えない', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve(rowsWithTask('claude-haiku-4-5-20251001', [1, 2, 3, 4])),
    );
    // tasks 1 and 2 had verify_repair / adversarial bounces
    transitionFindMany.mockImplementation(() => Promise.resolve([{ taskId: 1 }, { taskId: 2 }]));

    const outcomes = await getRoleModelOutcomes('implementer');
    expect(outcomes[0].samples).toBe(4);
    expect(outcomes[0].successes).toBe(2); // process-completed but gate-rejected ≠ success
    // The trouble query is scoped to implementer-indicting causes.
    const [args] = transitionFindMany.mock.calls[0] as [{ where: { cause: { in: string[] } } }];
    expect(args.where.cause.in).toContain('verify_repair');
    expect(args.where.cause.in).toContain('adversarial_review_failed');
  });

  // NOTE: was `researcher` until #577 gave that role critic-bounce attribution;
  // an unattributed role name keeps the "no-gate roles stay process-based" check.
  test('帰責原因の無いロールはプロセス完了ベースのまま', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve(rowsWithTask('claude-haiku-4-5-20251001', [1, 2])),
    );
    const outcomes = await getRoleModelOutcomes('summarizer');
    expect(outcomes[0].successes).toBe(2);
    expect(transitionFindMany).not.toHaveBeenCalled();
  });

  test('researcher: 批評差し戻し(research_critic_failed)のあったタスクの実行は成功に数えない', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve(rowsWithTask('claude-haiku-4-5-20251001', [1, 2, 3])),
    );
    // task 1 was bounced by the research critic gate (completed execution, rejected doc)
    transitionFindMany.mockImplementation(() => Promise.resolve([{ taskId: 1 }]));

    const outcomes = await getRoleModelOutcomes('researcher');
    expect(outcomes[0].samples).toBe(3);
    expect(outcomes[0].successes).toBe(2); // process-completed but critic-rejected ≠ success
    const [args] = transitionFindMany.mock.calls[0] as [{ where: { cause: { in: string[] } } }];
    expect(args.where.cause.in).toEqual(['research_critic_failed']);
  });

  test('planner: plan_critic_failed と plan_invalid_replan が帰責スコープに含まれる', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve(rowsWithTask('claude-haiku-4-5-20251001', [7, 8])),
    );
    transitionFindMany.mockImplementation(() => Promise.resolve([{ taskId: 8 }]));

    const outcomes = await getRoleModelOutcomes('planner');
    expect(outcomes[0].successes).toBe(1);
    const [args] = transitionFindMany.mock.calls[0] as [{ where: { cause: { in: string[] } } }];
    expect(args.where.cause.in).toContain('plan_critic_failed');
    expect(args.where.cause.in).toContain('plan_invalid_replan');
  });

  test('差し戻し照会が失敗しても集計は落ちない（レガシー定義に縮退）', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve(rowsWithTask('claude-haiku-4-5-20251001', [1])),
    );
    transitionFindMany.mockImplementation(() => Promise.reject(new Error('db down')));
    const outcomes = await getRoleModelOutcomes('implementer');
    expect(outcomes[0].successes).toBe(1);
  });
});

describe('resolveProvenTier — 二重窓判定 (45日 + 直近14日の劣化早期検知)', () => {
  /** Build n rows for a model created `daysAgo` days in the past, `fails` of which fail. */
  function rowsAt(modelName: string, n: number, daysAgo: number, fails = 0): unknown[] {
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return Array.from({ length: n }, (_, i) => ({
      status: i < fails ? 'failed' : 'completed',
      errorMessage: null,
      modelName,
      createdAt,
    }));
  }

  test('45日窓は合格でも直近14日窓が不合格なら proven にならない', async () => {
    // Overall: 23/24 = 95.8% ≥ 90%. Recent (4 samples ≥ 4): 3/4 = 75% < 90%.
    findMany.mockImplementation(() =>
      Promise.resolve([
        ...rowsAt('claude-haiku-4-5-20251001', 20, 30),
        ...rowsAt('claude-haiku-4-5-20251001', 4, 1, 1),
      ]),
    );
    expect(await resolveProvenTier('researcher')).toBeUndefined();
  });

  test('直近サンプル不足(<4)なら45日窓のみで判定し proven になる', async () => {
    // Overall: 30/33 = 90.9% ≥ 90%. Recent: 3 samples < 4 → recent gate not applied.
    findMany.mockImplementation(() =>
      Promise.resolve([
        ...rowsAt('claude-haiku-4-5-20251001', 30, 30),
        ...rowsAt('claude-haiku-4-5-20251001', 3, 1, 3),
      ]),
    );
    expect(await resolveProvenTier('researcher')).toBe('economy');
  });

  test('両窓とも合格なら proven のまま（直近窓は健全なモデルを落とさない）', async () => {
    // Overall: 24/24 = 100%. Recent: 4/4 = 100%.
    findMany.mockImplementation(() =>
      Promise.resolve([
        ...rowsAt('claude-haiku-4-5-20251001', 20, 30),
        ...rowsAt('claude-haiku-4-5-20251001', 4, 1),
      ]),
    );
    expect(await resolveProvenTier('researcher')).toBe('economy');
  });

  test('getRoleModelOutcomes は直近14日窓の統計を分離集計する', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        ...rowsAt('claude-haiku-4-5-20251001', 6, 30),
        ...rowsAt('claude-haiku-4-5-20251001', 4, 1, 2),
      ]),
    );
    const [outcome] = await getRoleModelOutcomes('implementer');
    expect(outcome.samples).toBe(10);
    expect(outcome.successes).toBe(8);
    expect(outcome.recentSamples).toBe(4);
    expect(outcome.recentSuccesses).toBe(2);
    expect(outcome.recentSuccessRate).toBeCloseTo(0.5);
  });
});

/**
 * repair-risk-model unit tests
 *
 * Band boundaries, sample building (fallback exclusion, null-phase exclusion,
 * cause attribution per stream), cell counting and the risk classification
 * boundaries (sample floor, threshold).
 */
import { describe, test, expect } from 'bun:test';
import {
  bucketKey,
  buildRepairRiskSamples,
  classifyComplexity,
  classifyInputLength,
  classifyRisk,
  computeRepairRiskBuckets,
  measuredInputChars,
  streamForRole,
  troubleCausesFor,
  type ContextMetricRow,
  type RepairRiskSample,
} from './repair-risk-model';

const BOUNDS = { shortMax: 2999, longMin: 9000 };
const d = (m: number) => new Date(Date.UTC(2026, 8, 1, 0, m));

describe('classifyComplexity', () => {
  test('3等分の境界', () => {
    expect(classifyComplexity(0)).toBe('low');
    expect(classifyComplexity(33)).toBe('low');
    expect(classifyComplexity(34)).toBe('mid');
    expect(classifyComplexity(66)).toBe('mid');
    expect(classifyComplexity(67)).toBe('high');
    expect(classifyComplexity(100)).toBe('high');
  });
  test('未確定は null', () => {
    expect(classifyComplexity(null)).toBeNull();
    expect(classifyComplexity(undefined)).toBeNull();
    expect(classifyComplexity(Number.NaN)).toBeNull();
  });
});

describe('classifyInputLength', () => {
  test('3帯の境界文字数', () => {
    expect(classifyInputLength(0, BOUNDS)).toBe('short');
    expect(classifyInputLength(2999, BOUNDS)).toBe('short');
    expect(classifyInputLength(3000, BOUNDS)).toBe('medium');
    expect(classifyInputLength(8999, BOUNDS)).toBe('medium');
    expect(classifyInputLength(9000, BOUNDS)).toBe('long');
  });
});

describe('role / cause vocabulary', () => {
  test('auto_verifier は verify に合算される', () => {
    expect(streamForRole('verifier')).toBe('verify');
    expect(streamForRole('auto_verifier')).toBe('verify');
    expect(streamForRole('researcher')).toBe('research');
    expect(streamForRole('reviewer')).toBeNull();
  });
  test('原因集合は ROLE_TROUBLE_CAUSES 由来', () => {
    expect(troubleCausesFor('implement').has('verify_repair')).toBe(true);
    expect(troubleCausesFor('plan').has('plan_critic_failed')).toBe(true);
    expect(troubleCausesFor('research').has('verify_repair')).toBe(false);
  });
});

describe('measuredInputChars', () => {
  const metrics: ContextMetricRow[] = [
    { taskId: 1, role: 'researcher', totalChars: 1000, createdAt: d(1) },
    { taskId: 1, role: 'researcher', totalChars: 5000, createdAt: d(5) },
    { taskId: 1, role: 'implementer', totalChars: 20000, createdAt: d(9) },
  ];
  test('research は説明文の長さ', () => {
    expect(measuredInputChars('research', 42, metrics)).toBe(42);
  });
  test('直前ロールの最新値のみを採用し、他ロールの値を混ぜない', () => {
    expect(measuredInputChars('plan', 42, metrics)).toBe(5000);
    expect(measuredInputChars('verify', 42, metrics)).toBe(20000);
  });
  test('planner 不在の implement は researcher にフォールバック', () => {
    expect(measuredInputChars('implement', 42, metrics)).toBe(5000);
  });
  test('直前ロールの計測が無ければ null', () => {
    expect(measuredInputChars('verify', 42, metrics.slice(0, 2))).toBeNull();
  });
});

describe('buildRepairRiskSamples', () => {
  const facts = new Map([
    [1, { complexityScore: 80, descriptionChars: 100 }],
    [2, { complexityScore: 80, descriptionChars: 100 }],
  ]);
  test('実行された段階ごとに1サンプル、差し戻し原因で repaired 判定', () => {
    const samples = buildRepairRiskSamples(
      [
        { taskId: 1, cause: 'verify_repair', phase: 'implementer', createdAt: d(10) },
        { taskId: 1, cause: 'research_critic_failed', phase: null, createdAt: d(2) },
      ],
      [
        { taskId: 1, role: 'researcher', totalChars: 4000, createdAt: d(1) },
        { taskId: 1, role: 'implementer', totalChars: 9000, createdAt: d(8) },
      ],
      facts,
    );
    const byStream = new Map(samples.map((s) => [s.stream, s]));
    expect(byStream.get('implement')).toMatchObject({ repaired: true, inputChars: 4000 });
    // phase=null の差し戻し行は集計対象外
    expect(byStream.get('research')).toMatchObject({ repaired: false, inputChars: 100 });
  });
  test('入力長が実測できない段階は学習データに含めない（フォールバック値を学習しない）', () => {
    const samples = buildRepairRiskSamples(
      [],
      [{ taskId: 2, role: 'verifier', totalChars: 9000, createdAt: d(1) }],
      facts,
    );
    expect(samples).toEqual([]);
  });
});

function samples(n: number, bad: number): RepairRiskSample[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: i,
    stream: 'implement' as const,
    complexityScore: 90,
    inputChars: 10000,
    repaired: i < bad,
  }));
}

describe('computeRepairRiskBuckets / classifyRisk', () => {
  const key = bucketKey('high', 'long', 'implement');
  const opts = { minSamples: 8, threshold: 0.4 };

  test('複雑度未確定のサンプルは数えない', () => {
    const table = computeRepairRiskBuckets(
      [{ ...samples(1, 1)[0]!, complexityScore: null }],
      BOUNDS,
    );
    expect(table.size).toBe(0);
  });

  test('しきい値ちょうど(0.4)・サンプル数ちょうど(8)は high — 高リスクを自動検出', () => {
    const table = computeRepairRiskBuckets(samples(10, 4), BOUNDS);
    expect(classifyRisk(key, table, opts)).toMatchObject({ risk: 'high', sampleSize: 10 });
    const eight = computeRepairRiskBuckets(samples(8, 4), BOUNDS);
    expect(classifyRisk(key, eight, opts).risk).toBe('high');
  });

  test('しきい値未満は low', () => {
    const table = computeRepairRiskBuckets(samples(10, 3), BOUNDS);
    expect(classifyRisk(key, table, opts)).toMatchObject({ risk: 'low', repairRate: 0.3 });
  });

  test('サンプル数が閾値未満なら差し戻し率が高くても indeterminate', () => {
    const table = computeRepairRiskBuckets(samples(7, 7), BOUNDS);
    expect(classifyRisk(key, table, opts)).toMatchObject({ risk: 'indeterminate', sampleSize: 7 });
  });

  test('セル不在・キー不在は indeterminate', () => {
    expect(classifyRisk(key, new Map(), opts).risk).toBe('indeterminate');
    expect(classifyRisk(null, new Map(), opts).risk).toBe('indeterminate');
  });
});

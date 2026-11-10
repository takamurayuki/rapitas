/**
 * seat-planner テスト
 *
 * 「使えるベンダー × ティア表 × 席の要件」からの席の再計算（追補5）を固定する:
 * 両ベンダー／片方のみ／途中での利用不能／制約を満たせない場合。
 */
import { describe, test, expect } from 'bun:test';
import { executorRefOf, planSeats, type SeatRequirement } from './seat-planner';
import { seatableEntries } from './tier-table';

/** Same shape as the jury's seats (jury-seats.ts JURY_SEAT_REQUIREMENTS). */
const SEATS: SeatRequirement[] = [
  { seatId: 'reviewer-1', role: 'reviewer', minTier: 'premium', independentOf: ['executor'] },
  {
    seatId: 'reviewer-2',
    role: 'reviewer',
    minTier: 'standard',
    independentOf: ['reviewer-1', 'executor'],
  },
  { seatId: 'verifier', role: 'verifier', minTier: 'premium', independentOf: ['executor'] },
];

const byId = (plan: ReturnType<typeof planSeats>) =>
  Object.fromEntries(plan.seats.map((s) => [s.seatId, s.entry.modelId]));

describe('planSeats', () => {
  test('両ベンダーが使える場合、レビュー席1は実行役と別系統に置く', () => {
    const plan = planSeats({
      requirements: SEATS,
      candidates: seatableEntries({ vendors: ['anthropic', 'openai'] }),
      executor: executorRefOf('claude-sonnet-5-5'),
    });
    expect(plan.mode).toBe('cross_vendor');
    expect(plan.shortfalls).toEqual([]);
    const r1 = plan.seats.find((s) => s.seatId === 'reviewer-1')!;
    expect(r1.entry.vendor).toBe('openai');
    expect(r1.entry.tier).toBe('premium');
    expect(r1.independence).toBe('cross_vendor');
    // Reviewer-2 comes from another family than reviewer-1, so the two blind
    // opinions are not one family's view counted twice.
    const r2 = plan.seats.find((s) => s.seatId === 'reviewer-2')!;
    expect(r2.entry.vendor).toBe('anthropic');
    expect(r2.entry.modelId).not.toBe('claude-sonnet-5-5'); // not the executor's own model
    expect(r2.independence).toBe('context_isolation');
    expect(plan.seats.find((s) => s.seatId === 'verifier')!.entry.vendor).toBe('openai');
  });

  test('Claude だけの CLI ホストでは文脈分離で組み、レビュー役は実行役以上を守る', () => {
    const plan = planSeats({
      requirements: SEATS,
      candidates: seatableEntries({ vendors: ['anthropic'], cliOnly: true }),
      executor: executorRefOf('sonnet'),
    });
    expect(plan.mode).toBe('single_vendor');
    expect(byId(plan)).toEqual({
      'reviewer-1': 'claude-opus-5-5',
      'reviewer-2': 'claude-sonnet-5-5',
      verifier: 'claude-opus-5-5',
    });
    expect(plan.seats.every((s) => s.independence === 'context_isolation')).toBe(true);
    // Fable has no confirmed CLI alias, so it is never seated on the CLI host.
    expect(Object.values(byId(plan))).not.toContain('claude-fable-5-2');
  });

  test('Codex（OpenAI）だけの場合も同じ規則で組む', () => {
    const plan = planSeats({
      requirements: SEATS,
      candidates: seatableEntries({ vendors: ['openai'] }),
      executor: executorRefOf('gpt-6.1-sol'),
    });
    expect(plan.shortfalls).toEqual([]);
    expect(byId(plan)).toEqual({
      'reviewer-1': 'gpt-6-astra',
      'reviewer-2': 'gpt-6.1-sol',
      verifier: 'gpt-6-astra',
    });
  });

  test('実行役が premium なら、standard 席の下限も premium に上がる（下げない）', () => {
    const plan = planSeats({
      requirements: SEATS,
      candidates: seatableEntries({ vendors: ['anthropic'], cliOnly: true }),
      executor: executorRefOf('claude-opus-5-5'),
    });
    const r2 = plan.seats.find((s) => s.seatId === 'reviewer-2')!;
    expect(r2.requiredTier).toBe('premium');
    expect(r2.entry.tier).toBe('premium');
    expect(plan.shortfalls).toEqual([]);
  });

  test('途中でベンダーが使えなくなったら、残った席は維持し、失った席だけ制約を保って再割り当てする', () => {
    const executor = executorRefOf('claude-sonnet-5-5');
    const before = planSeats({
      requirements: SEATS,
      candidates: seatableEntries({ vendors: ['anthropic', 'openai'] }),
      executor,
    });
    // OpenAI hits its quota mid-task.
    const after = planSeats({
      requirements: SEATS,
      candidates: seatableEntries({ vendors: ['anthropic'] }),
      executor,
      previous: before,
    });
    const r2Before = before.seats.find((s) => s.seatId === 'reviewer-2')!;
    const r2After = after.seats.find((s) => s.seatId === 'reviewer-2')!;
    expect(r2After.kept).toBe(true);
    expect(r2After.entry.modelId).toBe(r2Before.entry.modelId);
    const r1After = after.seats.find((s) => s.seatId === 'reviewer-1')!;
    expect(r1After.kept).toBe(false);
    expect(r1After.entry.vendor).toBe('anthropic');
    expect(r1After.entry.tier).toBe('premium');
    expect(after.mode).toBe('single_vendor');
    expect(after.shortfalls).toEqual([]);
  });

  test('制約を満たせない席は、基準を下げずに未充足として返す', () => {
    // Only Sonnet reachable: the premium seats cannot be filled by a lower tier.
    const sonnetOnly = seatableEntries({ vendors: ['anthropic'] }).filter(
      (e) => e.modelId === 'claude-sonnet-5-5',
    );
    const plan = planSeats({
      requirements: SEATS,
      candidates: sonnetOnly,
      executor: executorRefOf('claude-sonnet-5-5'),
    });
    expect(plan.seats.map((s) => s.seatId)).toEqual(['reviewer-2']);
    expect(plan.shortfalls.map((s) => [s.seatId, s.requiredTier])).toEqual([
      ['reviewer-1', 'premium'],
      ['verifier', 'premium'],
    ]);
    expect(plan.shortfalls[0].reason).toContain('premium');
  });

  test('使えるベンダーが無い場合は全席が未充足になり、理由が残る', () => {
    const plan = planSeats({ requirements: SEATS, candidates: [], executor: null });
    expect(plan.mode).toBe('none');
    expect(plan.seats).toEqual([]);
    expect(plan.shortfalls).toHaveLength(3);
    expect(plan.shortfalls[0].reason).toBe('使えるベンダーがない');
  });
});

describe('executorRefOf', () => {
  test('登録モデルは表の行に、未登録モデルは保守的なティアに解決する', () => {
    expect(executorRefOf('opus')).toEqual({
      modelId: 'claude-opus-5-5',
      vendor: 'anthropic',
      tier: 'premium',
    });
    // Unregistered but flagship-looking: capped at standard.
    expect(executorRefOf('claude-opus-4-20250514')?.tier).toBe('standard');
    expect(executorRefOf('')).toBeNull();
  });
});

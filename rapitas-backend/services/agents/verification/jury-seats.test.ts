/**
 * jury-seats テスト
 *
 * Seats are defined by role and tier; the host resolution turns them into
 * models through the tier table and the seat planner — from the vendors usable
 * right now, never below the seat's floor or the executor's tier.
 */
import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { DEFAULT_SEATS, assignSeats } from './jury-seats';
import { __resetCooldowns, markProviderCooldown } from '../../ai/provider-cooldown';

const saved = process.env.RAPITAS_JURY_MODELS;
beforeEach(() => {
  delete process.env.RAPITAS_JURY_MODELS;
  __resetCooldowns();
});
afterEach(() => {
  if (saved === undefined) delete process.env.RAPITAS_JURY_MODELS;
  else process.env.RAPITAS_JURY_MODELS = saved;
  __resetCooldowns();
});

describe('DEFAULT_SEATS', () => {
  test('レビュー席2つと検証席1つを、役割とティアだけで定義する', () => {
    expect(DEFAULT_SEATS).toEqual([
      { seatId: 'reviewer-1', role: 'reviewer', tier: 'premium' },
      { seatId: 'reviewer-2', role: 'reviewer', tier: 'standard' },
      { seatId: 'verifier', role: 'verifier', tier: 'premium' },
    ]);
    // No vendor or model in the definition itself.
    expect(JSON.stringify(DEFAULT_SEATS)).not.toMatch(/claude|opus|sonnet|gemini|gpt/i);
  });
});

/** A CLI host whose Claude CLI answers (configured-vendors.ts). */
const CLI_HOST = { configured: ['anthropic' as const], unconfigured: [] };

describe('assignSeats — CLI ホスト（Claude だけ）', () => {
  test('ティア表の現行モデルに解決し、CLI が実際に使うモデル名を持たせる', () => {
    const s = assignSeats({
      auxMode: 'cli',
      vendors: CLI_HOST,
      executorModel: 'claude-sonnet-5-5',
    });
    expect(s.reviewers.map((r) => [r.seatId, r.tier, r.model, r.resolvedModel])).toEqual([
      ['reviewer-1', 'premium', 'claude-opus-5-5', 'opus'],
      ['reviewer-2', 'standard', 'claude-sonnet-5-5', 'sonnet'],
    ]);
    expect(s.verifier.model).toBe('claude-opus-5-5');
    // Health tracking label stays per model, so a seat that keeps timing out rests.
    expect(s.reviewers[0].label).toBe('claude:opus');
    expect(s.plan.mode).toBe('single_vendor');
    expect(s.reviewers.every((r) => r.independence === 'context_isolation')).toBe(true);
  });

  test('実行役が premium なら、レビュー席2も premium にする（実行役以上）', () => {
    const s = assignSeats({ auxMode: 'cli', vendors: CLI_HOST, executorModel: 'opus' });
    expect(s.reviewers[1].model).toBe('claude-opus-5-5');
    expect(s.plan.shortfalls).toEqual([]);
  });

  test('実行役が確認できない場合は premium とみなし、レビュー席2を standard にしない', () => {
    const s = assignSeats({ auxMode: 'cli', vendors: CLI_HOST, executorModel: null });
    expect(s.plan.executor.verified).toBe(false);
    expect(s.reviewers[1].model).toBe('claude-opus-5-5');
    expect(s.plan.seats.every((x) => x.requiredTier === 'premium')).toBe(true);
  });

  test('Claude が利用不能（クォータ枯渇）なら、席を下げずに未充足として返す', () => {
    markProviderCooldown('claude', 'quota', undefined, {});
    const s = assignSeats({ auxMode: 'cli', vendors: CLI_HOST, executorModel: 'gpt-6.1-sol' });
    expect(s.plan.shortfalls.map((x) => x.seatId)).toEqual([
      'reviewer-1',
      'reviewer-2',
      'verifier',
    ]);
    expect(s.reviewers.every((r) => typeof r.unmet === 'string')).toBe(true);
    expect(s.verifier.unmet).toBeDefined();
    // Two unmet seats are never mistaken for one model asked twice.
    expect(s.reviewers[0].resolvedModel).not.toBe(s.reviewers[1].resolvedModel);
  });

  test('Claude CLI が見つからない CLI ホストでは、全席を未充足にして理由を残す', () => {
    const s = assignSeats({
      auxMode: 'cli',
      vendors: {
        configured: [],
        unconfigured: [{ vendor: 'anthropic', reason: 'Claude CLI が見つからない・起動しない' }],
      },
      executorModel: 'sonnet',
    });
    expect(s.plan.seats).toEqual([]);
    expect(s.verifier.unmet).toBeDefined();
    expect(s.unavailable).toEqual([
      { vendor: 'anthropic', reason: 'Claude CLI が見つからない・起動しない' },
    ]);
  });

  test('使えるベンダーが渡されなければ、どの席も埋めない（既定で3社を仮定しない）', () => {
    const s = assignSeats({ auxMode: 'api', executorModel: 'sonnet' });
    expect(s.plan.seats).toEqual([]);
    expect(s.plan.shortfalls).toHaveLength(3);
  });
});

describe('assignSeats — RAPITAS_JURY_MODELS（上書き）', () => {
  test('要件を満たす上書きは席の順（レビュー1・レビュー2・検証）に割り当て、記録にも残す', () => {
    process.env.RAPITAS_JURY_MODELS = 'opus,claude-opus-5-5';
    const s = assignSeats({ auxMode: 'cli', vendors: CLI_HOST, executorModel: 'sonnet' });
    expect(s.reviewers.map((r) => r.model)).toEqual(['claude-opus-5-5', 'claude-opus-5-5']);
    // The record is what actually sits — the override included (reviewer-2
    // would otherwise be the planner's Sonnet).
    const r2 = s.plan.seats.find((x) => x.seatId === 'reviewer-2')!;
    expect(r2.entry.modelId).toBe('claude-opus-5-5');
    expect(r2.overridden).toBe(true);
    // Unlisted seat keeps its planned model.
    expect(s.verifier.model).toBe('claude-opus-5-5');
    expect(s.plan.shortfalls).toEqual([]);
  });

  test('実行役が Opus のとき haiku,haiku,haiku は全席を未充足にし、Haiku では動かさない', () => {
    process.env.RAPITAS_JURY_MODELS = 'haiku,haiku,haiku';
    const s = assignSeats({ auxMode: 'cli', vendors: CLI_HOST, executorModel: 'opus' });
    expect([...s.reviewers, s.verifier].every((x) => typeof x.unmet === 'string')).toBe(true);
    expect([...s.reviewers, s.verifier].some((x) => x.resolvedModel === 'haiku')).toBe(false);
    // The plan records what happened: no seat filled, three shortfalls naming the override.
    expect(s.plan.seats).toEqual([]);
    expect(s.plan.shortfalls.map((x) => [x.seatId, x.override])).toEqual([
      ['reviewer-1', 'haiku'],
      ['reviewer-2', 'haiku'],
      ['verifier', 'haiku'],
    ]);
  });

  test('実行役より下のティアの上書きは未充足（Sonnet の上書き・実行役 Opus）', () => {
    process.env.RAPITAS_JURY_MODELS = ',sonnet';
    const s = assignSeats({ auxMode: 'cli', vendors: CLI_HOST, executorModel: 'opus' });
    expect(s.reviewers[0].model).toBe('claude-opus-5-5');
    expect(s.reviewers[1].unmet).toMatch(/premium 以上/);
  });

  test('未登録・CLI 経路にない上書きは未充足（Fable は CLI で haiku として起動されるため）', () => {
    process.env.RAPITAS_JURY_MODELS = 'claude-opus-4-6,claude-fable-5-2,some-unknown-id';
    const s = assignSeats({ auxMode: 'cli', vendors: CLI_HOST, executorModel: 'sonnet' });
    expect(s.reviewers[0].unmet).toMatch(/登録がない/);
    expect(s.reviewers[1].unmet).toMatch(/使えるベンダー・経路にない/);
    expect(s.verifier.unmet).toMatch(/登録がない/);
    expect([...s.reviewers, s.verifier].some((x) => x.resolvedModel === 'haiku')).toBe(false);
  });
});

describe('assignSeats — API ホスト', () => {
  test('両ベンダーが使えるなら、レビュー席1を実行役と別系統にする', () => {
    const s = assignSeats({
      auxMode: 'api',
      providers: ['claude', 'chatgpt'],
      executorModel: 'claude-sonnet-5-5',
    });
    expect(s.plan.mode).toBe('cross_vendor');
    expect(s.reviewers[0].provider).toBe('chatgpt');
    expect(s.reviewers[0].model).toBe('gpt-6-astra');
    expect(s.reviewers[0].independence).toBe('cross_vendor');
    expect(s.reviewers[1].provider).toBe('claude');
  });

  test('API キーのないベンダーには席を置かない（Anthropic だけ設定済み）', () => {
    const s = assignSeats({
      auxMode: 'api',
      vendors: {
        configured: ['anthropic'],
        unconfigured: [
          { vendor: 'openai', reason: 'API キーが設定されていない' },
          { vendor: 'google', reason: 'API キーが設定されていない' },
        ],
      },
      executorModel: 'claude-sonnet-5-5',
    });
    expect([...s.reviewers, s.verifier].map((x) => x.provider)).toEqual([
      'claude',
      'claude',
      'claude',
    ]);
    expect(s.unavailable.map((u) => u.vendor)).toEqual(['openai', 'google']);
  });

  test('途中で片方が利用不能になったら、残ったベンダーで制約を保って組み直す', () => {
    markProviderCooldown('openai', 'quota', undefined, {});
    const s = assignSeats({
      auxMode: 'api',
      providers: ['claude', 'chatgpt'],
      executorModel: 'claude-sonnet-5-5',
    });
    expect(s.plan.mode).toBe('single_vendor');
    expect(s.reviewers.map((r) => r.provider)).toEqual(['claude', 'claude']);
    expect(s.reviewers[0].tier).toBe('premium');
    // The cheapest premium that may review — Opus, not the costlier Fable.
    expect(s.reviewers[0].model).toBe('claude-opus-5-5');
    expect(s.unavailable).toEqual([{ vendor: 'openai', reason: 'quota' }]);
  });

  test('到達できるプロバイダを独立性の優先順に割り当てる', () => {
    const s = assignSeats({
      auxMode: 'api',
      providers: ['gemini', 'chatgpt'],
      executorModel: 'llama3',
    });
    expect(s.reviewers.map((r) => r.provider)).toEqual(['gemini', 'chatgpt']);
    expect(s.verifier.provider).toBe('gemini');
  });
});

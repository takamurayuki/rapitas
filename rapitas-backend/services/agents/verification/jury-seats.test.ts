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

describe('assignSeats — CLI ホスト（Claude だけ）', () => {
  test('ティア表の現行モデルに解決し、CLI が実際に使うモデル名を持たせる', () => {
    const s = assignSeats({ auxMode: 'cli', executorModel: 'claude-sonnet-5-5' });
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
    const s = assignSeats({ auxMode: 'cli', executorModel: 'opus' });
    expect(s.reviewers[1].model).toBe('claude-opus-5-5');
    expect(s.plan.shortfalls).toEqual([]);
  });

  test('Claude が利用不能（クォータ枯渇）なら、席を下げずに未充足として返す', () => {
    markProviderCooldown('claude', 'quota', undefined, {});
    const s = assignSeats({ auxMode: 'cli', executorModel: 'gpt-6.1-sol' });
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

  test('RAPITAS_JURY_MODELS は席の順（レビュー1・レビュー2・検証）に割り当てる', () => {
    process.env.RAPITAS_JURY_MODELS = 'claude-sonnet-4-20250514,claude-sonnet-4-20250514';
    const s = assignSeats({ auxMode: 'cli' });
    expect(s.reviewers.map((r) => r.model)).toEqual([
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-20250514',
    ]);
    // Unlisted seat keeps its planned model.
    expect(s.verifier.model).toBe('claude-opus-5-5');
  });

  test('上書き指定でも、席に CLI が実際に使うモデル名（--model の値）を持たせる', () => {
    process.env.RAPITAS_JURY_MODELS = 'opus,claude-opus-4-6,some-unknown-id';
    const s = assignSeats({ auxMode: 'cli' });
    expect(s.reviewers.map((r) => r.resolvedModel)).toEqual(['opus', 'opus']);
    // The CLI provider sends an unrecognised id as haiku.
    expect(s.verifier.resolvedModel).toBe('haiku');
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
    const s = assignSeats({ auxMode: 'api', providers: ['gemini', 'chatgpt'] });
    expect(s.reviewers.map((r) => r.provider)).toEqual(['gemini', 'chatgpt']);
    expect(s.verifier.provider).toBe('gemini');
  });
});

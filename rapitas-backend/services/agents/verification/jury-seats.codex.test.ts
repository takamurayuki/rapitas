/**
 * jury-seats.codex テスト
 *
 * CLI ホストで Codex CLI が使えるとき（routing2b）の席の解決: OpenAI の行は
 * Codex 経路（provider chatgpt / cliRoute codex / -m にそのままの ID）で座り、
 * Claude CLI の haiku に化けない。席の規則（下限・実行役以上・別系統優先）は
 * 変えない。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { assignSeats } from './jury-seats';
import { __resetCooldowns, markProviderCooldown } from '../../ai/provider-cooldown';

const CODEX_ONLY = { configured: ['openai' as const], unconfigured: [] };
const BOTH = { configured: ['anthropic' as const, 'openai' as const], unconfigured: [] };

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

const view = (s: ReturnType<typeof assignSeats>) =>
  [...s.reviewers, s.verifier].map((r) => ({
    seat: r.seatId,
    provider: r.provider,
    cliRoute: r.cliRoute,
    model: r.model,
    label: r.label,
    resolvedModel: r.resolvedModel,
  }));

describe('assignSeats — CLI ホスト（Codex だけ）', () => {
  test('実行役 sol: astra／sol／astra を Codex 経路で、記録どおりの ID で座らせる', () => {
    const s = assignSeats({ auxMode: 'cli', vendors: CODEX_ONLY, executorModel: 'gpt-6.1-sol' });
    expect(view(s)).toEqual([
      {
        seat: 'reviewer-1',
        provider: 'chatgpt',
        cliRoute: 'codex',
        model: 'gpt-6-astra',
        label: 'codex:gpt-6-astra',
        resolvedModel: 'gpt-6-astra',
      },
      {
        seat: 'reviewer-2',
        provider: 'chatgpt',
        cliRoute: 'codex',
        model: 'gpt-6.1-sol',
        label: 'codex:gpt-6.1-sol',
        resolvedModel: 'gpt-6.1-sol',
      },
      {
        seat: 'verifier',
        provider: 'chatgpt',
        cliRoute: 'codex',
        model: 'gpt-6-astra',
        label: 'codex:gpt-6-astra',
        resolvedModel: 'gpt-6-astra',
      },
    ]);
    // Regression: the old CLI branch mapped every OpenAI id to `haiku`.
    expect(view(s).some((r) => r.resolvedModel === 'haiku')).toBe(false);
    expect(s.reviewers[0].resolvedModel).not.toBe(s.reviewers[1].resolvedModel);
    expect(s.plan.mode).toBe('single_vendor');
    expect(s.plan.shortfalls).toEqual([]);
  });

  test('実行役 astra（premium）: レビュー席2も astra。sol では埋めない', () => {
    const s = assignSeats({ auxMode: 'cli', vendors: CODEX_ONLY, executorModel: 'gpt-6-astra' });
    expect(s.reviewers.map((r) => r.model)).toEqual(['gpt-6-astra', 'gpt-6-astra']);
    expect(s.plan.seats.every((x) => x.requiredTier === 'premium')).toBe(true);
  });

  test('OpenAI がクォータ枯渇なら、3席とも未充足（Claude CLI にも流さない）', () => {
    markProviderCooldown('openai', 'quota');
    const s = assignSeats({ auxMode: 'cli', vendors: CODEX_ONLY, executorModel: 'gpt-6.1-sol' });
    expect(s.plan.shortfalls.map((x) => x.seatId)).toEqual([
      'reviewer-1',
      'reviewer-2',
      'verifier',
    ]);
    expect(s.unavailable).toEqual([expect.objectContaining({ vendor: 'openai', reason: 'quota' })]);
  });

  test('RAPITAS_JURY_MODELS に OpenAI の ID を書けば、規則を満たす限りそれを座らせる', () => {
    process.env.RAPITAS_JURY_MODELS = 'gpt-6-astra,gpt-6-astra,gpt-6-astra';
    const s = assignSeats({ auxMode: 'cli', vendors: CODEX_ONLY, executorModel: 'gpt-6.1-sol' });
    expect(s.reviewers.map((r) => [r.model, r.cliRoute])).toEqual([
      ['gpt-6-astra', 'codex'],
      ['gpt-6-astra', 'codex'],
    ]);
    // An economy override is still refused, not seated below its floor.
    process.env.RAPITAS_JURY_MODELS = 'gpt-6-luna';
    const refused = assignSeats({
      auxMode: 'cli',
      vendors: CODEX_ONLY,
      executorModel: 'gpt-6.1-sol',
    });
    expect(refused.reviewers[0].unmet).toBeDefined();
  });
});

describe('assignSeats — CLI ホスト（Claude と Codex の両方）', () => {
  test('実行役 sol: レビュー席1と検証席は opus（別系統）、席2は astra', () => {
    const s = assignSeats({ auxMode: 'cli', vendors: BOTH, executorModel: 'gpt-6.1-sol' });
    expect(view(s).map((r) => [r.seat, r.model, r.cliRoute])).toEqual([
      ['reviewer-1', 'claude-opus-5-5', 'claude'],
      ['reviewer-2', 'gpt-6-astra', 'codex'],
      ['verifier', 'claude-opus-5-5', 'claude'],
    ]);
    expect(s.plan.mode).toBe('cross_vendor');
    expect(s.reviewers[0].independence).toBe('cross_vendor');
  });

  test('実行役 opus: レビュー席1と検証席は astra（別系統）', () => {
    const s = assignSeats({ auxMode: 'cli', vendors: BOTH, executorModel: 'claude-opus-5-5' });
    expect(s.reviewers[0].model).toBe('gpt-6-astra');
    expect(s.verifier.model).toBe('gpt-6-astra');
    expect(s.reviewers[0].cliRoute).toBe('codex');
  });

  test('Claude がクォータ枯渇: Codex だけで組み直し、Anthropic は理由つきで外す', () => {
    markProviderCooldown('claude', 'quota');
    const s = assignSeats({ auxMode: 'cli', vendors: BOTH, executorModel: 'gpt-6.1-sol' });
    expect(s.reviewers.map((r) => r.model)).toEqual(['gpt-6-astra', 'gpt-6.1-sol']);
    expect(s.unavailable.map((u) => u.vendor)).toEqual(['anthropic']);
  });

  test('Google が設定済みでも CLI ホストでは座らない（補助 CLI の経路が無い）', () => {
    const s = assignSeats({
      auxMode: 'cli',
      vendors: { configured: ['google', 'openai'], unconfigured: [] },
      executorModel: 'gpt-6.1-sol',
    });
    expect(view(s).every((r) => r.provider === 'chatgpt')).toBe(true);
  });
});

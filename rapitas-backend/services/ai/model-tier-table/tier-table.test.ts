/**
 * tier-table テスト
 *
 * ティア表が唯一の正本として、登録モデルの行・未登録モデルの保守的な既定・
 * 役割適性を返すこと、各行に公式の参照元と確認日があることを固定する。
 */
import { describe, test, expect } from 'bun:test';
import {
  MODEL_TIER_TABLE,
  capUnregisteredTier,
  costPer1kOf,
  findModelEntry,
  isSuitableForRole,
  seatableEntries,
  vendorOfProvider,
} from './tier-table';

describe('MODEL_TIER_TABLE の内容', () => {
  test('Anthropic の現行ライン4モデルを公式の位置づけどおりに登録する', () => {
    const tiers = Object.fromEntries(
      MODEL_TIER_TABLE.filter((e) => e.vendor === 'anthropic').map((e) => [e.modelId, e.tier]),
    );
    expect(tiers).toEqual({
      'claude-fable-5-2': 'premium',
      'claude-opus-5-5': 'premium',
      'claude-sonnet-5-5': 'standard',
      'claude-haiku-5-5': 'economy',
    });
    const opus = findModelEntry('claude-opus-5-5');
    expect(opus?.price).toEqual({ input: 4, output: 20 });
    expect(opus?.contextTokens).toBe(1_000_000);
  });

  test('OpenAI（Codex）の現行ラインを登録し、非推奨の GPT-5.3-Codex は席に置かない', () => {
    expect(findModelEntry('gpt-6-astra')?.tier).toBe('premium');
    expect(findModelEntry('gpt-6.1-sol')?.tier).toBe('standard');
    expect(findModelEntry('gpt-6.1-terra')?.tier).toBe('economy');
    expect(findModelEntry('gpt-6-luna')?.tier).toBe('economy');
    const codex = findModelEntry('gpt-5.3-codex');
    expect(codex?.status).toBe('deprecated');
    expect(codex?.roles.review).toBe(false);
    expect(seatableEntries({ vendors: ['openai'] }).map((e) => e.modelId)).not.toContain(
      'gpt-5.3-codex',
    );
  });

  test('Google（Gemini）の現行ラインを登録する', () => {
    expect(findModelEntry('gemini-4-argon')?.tier).toBe('premium');
    expect(findModelEntry('gemini-3.8-flash')?.tier).toBe('standard');
    expect(findModelEntry('gemini-3.5-flash-lite')?.tier).toBe('economy');
  });

  test('すべての行に公式の参照元と確認日がある（二次情報で埋めない）', () => {
    const official =
      /^https:\/\/(platform\.claude\.com|platform\.openai\.com|developers\.openai\.com|ai\.google\.dev)\//;
    for (const e of MODEL_TIER_TABLE) {
      expect(e.checkedAt).toBe('2026-11-10');
      expect(e.sources.length).toBeGreaterThan(0);
      for (const s of e.sources) expect(s).toMatch(official);
    }
  });

  test('economy の行はレビューに置かない', () => {
    for (const e of MODEL_TIER_TABLE.filter((x) => x.tier === 'economy')) {
      expect(e.roles.review).toBe(false);
    }
  });
});

describe('findModelEntry', () => {
  test('CLI エイリアスと各社 API の接頭辞付き ID も同じ行に解決する', () => {
    expect(findModelEntry('opus')?.modelId).toBe('claude-opus-5-5');
    expect(findModelEntry('Sonnet')?.modelId).toBe('claude-sonnet-5-5');
    expect(findModelEntry('models/gemini-4-argon')?.modelId).toBe('gemini-4-argon');
    expect(findModelEntry('anthropic.claude-haiku-5-5')?.modelId).toBe('claude-haiku-5-5');
  });

  test('表にない ID は行を返さない（似た名前でも推測しない）', () => {
    expect(findModelEntry('claude-opus-4-20250514')).toBeNull();
    expect(findModelEntry('gpt-6-astra-preview')).toBeNull();
    expect(findModelEntry(null)).toBeNull();
  });

  test('Fable は premium（陪審 tierOf が haiku 級と誤分類していた件）', () => {
    expect(findModelEntry('claude-fable-5-2')?.tier).toBe('premium');
  });
});

describe('未登録モデルの既定と役割適性', () => {
  test('未登録モデルのティアは standard を上限にする', () => {
    expect(capUnregisteredTier('premium')).toBe('standard');
    expect(capUnregisteredTier('standard')).toBe('standard');
    expect(capUnregisteredTier('economy')).toBe('economy');
    expect(capUnregisteredTier('free')).toBe('free');
  });

  test('未登録モデルは実行はできるがレビューには置かない', () => {
    expect(isSuitableForRole('some-new-model', 'implementer')).toBe(true);
    expect(isSuitableForRole('some-new-model', 'verifier')).toBe(false);
    expect(isSuitableForRole('claude-haiku-5-5', 'verifier')).toBe(false);
    expect(isSuitableForRole('claude-sonnet-5-5', 'verifier')).toBe(true);
    expect(isSuitableForRole('gpt-5.3-codex', 'auto_verifier')).toBe(false);
    // Roles the table does not cover are not restricted.
    expect(isSuitableForRole('some-new-model', 'custom-role')).toBe(true);
  });
});

describe('補助関数', () => {
  test('価格から 1K トークンあたりの平均単価を出す', () => {
    expect(costPer1kOf(findModelEntry('claude-opus-5-5')!)).toBeCloseTo(0.012, 6);
  });

  test('プロバイダ名（discovery／ai-client の両方式）をベンダーに対応させる', () => {
    expect(vendorOfProvider('claude')).toBe('anthropic');
    expect(vendorOfProvider('chatgpt')).toBe('openai');
    expect(vendorOfProvider('openai')).toBe('openai');
    expect(vendorOfProvider('gemini')).toBe('google');
    expect(vendorOfProvider('ollama')).toBeNull();
  });

  test('CLI 経路では CLI 別名が確認できた行だけを席の候補にする', () => {
    const ids = seatableEntries({ vendors: ['anthropic'], cliOnly: true }).map((e) => e.modelId);
    expect(ids).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  });
});

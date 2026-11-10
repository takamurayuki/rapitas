/**
 * tier-classifier テスト
 *
 * モデルID→ティア分類を固定する。ティア表（model-tier-table）に登録された
 * モデルは表の値をそのまま返し、未登録モデルだけ名前ヒューリスティックで
 * 分類したうえで standard を上限にする（追補3: 未評価モデルは保守的な配置）。
 * o3-mini 等の小型バリアントが economy に入ること（economy 判定の順序）も守る。
 */
import { describe, test, expect } from 'bun:test';
import { classifyTier, inferCostPer1k } from './tier-classifier';

describe('classifyTier', () => {
  test('ティア表に登録されたモデルは表のティアを返す', () => {
    expect(classifyTier('claude-fable-5-2')).toBe('premium');
    expect(classifyTier('claude-opus-5-5')).toBe('premium');
    expect(classifyTier('opus')).toBe('premium');
    expect(classifyTier('claude-sonnet-5-5')).toBe('standard');
    expect(classifyTier('sonnet')).toBe('standard');
    expect(classifyTier('claude-haiku-5-5')).toBe('economy');
    expect(classifyTier('gpt-6-astra')).toBe('premium');
    expect(classifyTier('gpt-6.1-sol')).toBe('standard');
    expect(classifyTier('gpt-6-luna')).toBe('economy');
    expect(classifyTier('gemini-4-argon')).toBe('premium');
    expect(classifyTier('models/gemini-3.8-flash')).toBe('standard');
  });

  test('ローカル/自己ホストは free', () => {
    expect(classifyTier('llama3.1:8b')).toBe('free');
    expect(classifyTier('qwen2.5-coder')).toBe('free');
    expect(classifyTier('deepseek-r1')).toBe('free');
  });

  test('未登録のフラッグシップ風の名前は premium にせず standard に留める', () => {
    // NOTE: Before the tier table these were premium by name alone.
    expect(classifyTier('claude-fable-5')).toBe('standard');
    expect(classifyTier('claude-mythos-5')).toBe('standard');
    expect(classifyTier('claude-opus-4-8')).toBe('standard');
    expect(classifyTier('gpt-5')).toBe('standard');
    expect(classifyTier('o3')).toBe('standard');
    expect(classifyTier('gemini-2.5-pro')).toBe('standard');
  });

  test('小型バリアントは economy（premiumファミリー名を含んでいても）', () => {
    expect(classifyTier('claude-haiku-4-5-20251001')).toBe('economy');
    expect(classifyTier('o3-mini')).toBe('economy'); // 旧実装はpremiumに誤分類
    expect(classifyTier('gpt-5-mini')).toBe('economy');
    expect(classifyTier('gemini-2.5-flash')).toBe('economy');
    expect(classifyTier('gpt-4o-mini')).toBe('economy');
  });

  test('未登録の既定は standard（gpt-4o 等）', () => {
    expect(classifyTier('claude-sonnet-5')).toBe('standard');
    expect(classifyTier('gpt-4o')).toBe('standard');
  });
});

describe('inferCostPer1k', () => {
  test('ティア表に登録されたモデルは表の価格（入出力の平均）を使う', () => {
    expect(inferCostPer1k('claude-opus-5-5', 'premium')).toBeCloseTo(0.012, 6);
    expect(inferCostPer1k('claude-fable-5-2', 'premium')).toBeCloseTo(0.024, 6);
    expect(inferCostPer1k('gpt-6-astra', 'premium')).toBeCloseTo(0.03, 6);
  });

  test('未登録モデルはティアに応じた概算単価を返す', () => {
    expect(inferCostPer1k('llama3', 'free')).toBe(0);
    expect(inferCostPer1k('claude-haiku-4-5', 'economy')).toBe(0.001);
    expect(inferCostPer1k('gpt-4o', 'standard')).toBe(0.006);
    expect(inferCostPer1k('claude-opus-4-8', 'premium')).toBe(0.025);
    expect(inferCostPer1k('gpt-5', 'premium')).toBe(0.012);
  });

  test('premium帯でfable/mythosはopusより高い単価になる（#797: opus未満誤推定でcheapest()がfableを誤選択していたバグ）', () => {
    expect(inferCostPer1k('claude-fable-5', 'premium')).toBeGreaterThan(
      inferCostPer1k('claude-opus-4-8', 'premium'),
    );
    expect(inferCostPer1k('claude-mythos-5', 'premium')).toBeGreaterThan(
      inferCostPer1k('claude-opus-4-8', 'premium'),
    );
    expect(inferCostPer1k('claude-fable-5-2', 'premium')).toBeGreaterThan(
      inferCostPer1k('claude-opus-5-5', 'premium'),
    );
  });
});

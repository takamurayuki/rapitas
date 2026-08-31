/**
 * tier-classifier テスト
 *
 * モデルID→ティア分類の名前ヒューリスティックを固定する。特に:
 * fable/mythos（Opus超のMythos級）がpremiumであること、o3-mini等の
 * 小型バリアントがpremiumに誤爆しないこと（economy判定を先に通す）。
 */
import { describe, test, expect } from 'bun:test';
import { classifyTier, inferCostPer1k } from './tier-classifier';

describe('classifyTier', () => {
  test('ローカル/自己ホストは free', () => {
    expect(classifyTier('llama3.1:8b')).toBe('free');
    expect(classifyTier('qwen2.5-coder')).toBe('free');
    expect(classifyTier('deepseek-r1')).toBe('free');
  });

  test('フラッグシップは premium（fable/mythos含む — 現CLIはclaude-fable-5を広告）', () => {
    expect(classifyTier('claude-fable-5')).toBe('premium');
    expect(classifyTier('claude-mythos-5')).toBe('premium');
    expect(classifyTier('claude-opus-4-8')).toBe('premium');
    expect(classifyTier('opus')).toBe('premium');
    expect(classifyTier('gpt-5')).toBe('premium');
    expect(classifyTier('o3')).toBe('premium');
    expect(classifyTier('gemini-2.5-pro')).toBe('premium');
  });

  test('小型バリアントは economy（premiumファミリー名を含んでいても）', () => {
    expect(classifyTier('claude-haiku-4-5-20251001')).toBe('economy');
    expect(classifyTier('o3-mini')).toBe('economy'); // 旧実装はpremiumに誤分類
    expect(classifyTier('gpt-5-mini')).toBe('economy');
    expect(classifyTier('gemini-2.5-flash')).toBe('economy');
    expect(classifyTier('gpt-4o-mini')).toBe('economy');
  });

  test('既定は standard（sonnet / gpt-4o 等）', () => {
    expect(classifyTier('claude-sonnet-5')).toBe('standard');
    expect(classifyTier('sonnet')).toBe('standard');
    expect(classifyTier('gpt-4o')).toBe('standard');
  });
});

describe('inferCostPer1k', () => {
  test('ティアに応じた概算単価を返す', () => {
    expect(inferCostPer1k('llama3', 'free')).toBe(0);
    expect(inferCostPer1k('haiku', 'economy')).toBe(0.001);
    expect(inferCostPer1k('sonnet', 'standard')).toBe(0.006);
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
  });
});

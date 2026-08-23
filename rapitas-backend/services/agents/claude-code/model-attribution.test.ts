/**
 * model-attribution テスト
 *
 * 実行を「どのモデルの仕事として記録するか」の判定を検証する。
 */
import { describe, test, expect } from 'bun:test';
import { pickPrimaryModel } from './model-attribution';

describe('pickPrimaryModel', () => {
  test('コスト報告があればコスト最大のモデルを選ぶ', () => {
    expect(
      pickPrimaryModel({
        'claude-haiku-4-5-20251001': { inputTokens: 9000, outputTokens: 400, costUsd: 0.01 },
        'claude-fable-5': { inputTokens: 120, outputTokens: 3000, costUsd: 7.05 },
      }),
    ).toBe('claude-fable-5');
  });

  test('回帰: 非キャッシュ input だけで比べると裏方モデルが勝ってしまう', () => {
    // 実測 2026-08-18 のタスク629 実装フェーズの形。ルーターは fable-5 を選び、
    // 実際に $7.06 使ったのも fable-5 だが、旧実装は input+output だけを見て
    // haiku(バックグラウンド用途)を主モデルとして記録していた。
    const usage = {
      'claude-haiku-4-5-20251001': {
        inputTokens: 41_000,
        outputTokens: 1_200,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0,
      },
      'claude-fable-5': {
        inputTokens: 900,
        outputTokens: 28_000,
        cacheReadInputTokens: 5_900_000,
        cacheCreationInputTokens: 210_000,
        costUsd: 0,
      },
    };
    // 旧ロジック相当（非キャッシュのみ）なら haiku が勝つ。
    expect(usage['claude-haiku-4-5-20251001'].inputTokens).toBeGreaterThan(
      usage['claude-fable-5'].inputTokens,
    );
    // 新ロジックはキャッシュ込みの総トークンで判定する。
    expect(pickPrimaryModel(usage)).toBe('claude-fable-5');
  });

  test('空・未定義の usage は undefined を返す', () => {
    expect(pickPrimaryModel(undefined)).toBeUndefined();
    expect(pickPrimaryModel({})).toBeUndefined();
  });

  test('同点はモデル名で決定的に解決する', () => {
    const tie = { bbb: { inputTokens: 10 }, aaa: { inputTokens: 10 } };
    expect(pickPrimaryModel(tie)).toBe('aaa');
    expect(pickPrimaryModel({ aaa: { inputTokens: 10 }, bbb: { inputTokens: 10 } })).toBe('aaa');
  });
});

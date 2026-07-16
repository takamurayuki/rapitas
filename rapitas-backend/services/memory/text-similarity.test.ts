/**
 * text-similarity テスト
 *
 * bigram-Jaccard と近似重複ペア判定を検証: 実際に矛盾バックログを支配していた
 * 「同一教訓の言い換え」ペアが重複と判定され、無関係・真に矛盾するペアは
 * 重複と判定されないこと。
 */
import { describe, test, expect } from 'bun:test';
import { bigramSimilarity, isNearDuplicatePair } from './text-similarity';

describe('bigramSimilarity', () => {
  test('identical strings → 1', () => {
    expect(bigramSimilarity('マージ競合解消の原則', 'マージ競合解消の原則')).toBe(1);
  });

  test('unrelated strings → near 0', () => {
    expect(bigramSimilarity('マージ競合解消の原則', 'SQLiteの接続プール設定')).toBeLessThan(0.1);
  });

  test('normalization ignores punctuation and whitespace', () => {
    expect(
      bigramSimilarity('PR ブランチ更新は push で完結させる', 'PRブランチ更新はpushで完結させる'),
    ).toBe(1);
  });
});

describe('isNearDuplicatePair', () => {
  test('real backlog pair: same lesson retitled → duplicate', () => {
    // Actual titles observed dominating the 8,883-row backlog.
    const a = {
      title: 'マージ競合解消の原則',
      content: 'マージ競合を解消する際は両方の変更意図を保持し、競合マーカーを完全に除去する。',
    };
    const b = {
      title: 'マージ競合解消時の原則',
      content: '競合を解消するときは両側の変更の意図を保ち、マーカーを残さないこと。',
    };
    expect(isNearDuplicatePair(a, b)).toBe(true);
  });

  test('genuinely contradicting entries on the same topic → NOT a duplicate', () => {
    const a = {
      title: 'デプロイは金曜日に行う',
      content: '週末に監視できるため、デプロイは金曜日の夕方に実施するのが最適である。',
    };
    const b = {
      title: 'デプロイ禁止曜日',
      content: '障害対応が困難になるため、金曜日のデプロイは絶対に避けるべきである。',
    };
    expect(isNearDuplicatePair(a, b)).toBe(false);
  });

  test('unrelated entries → NOT a duplicate', () => {
    const a = {
      title: 'ESLintの設定',
      content: 'flat configではpluginsをオブジェクトで登録する。',
    };
    const b = { title: 'Tauriの権限', content: 'shell:allow-openにはスコープを設定できる。' };
    expect(isNearDuplicatePair(a, b)).toBe(false);
  });
});

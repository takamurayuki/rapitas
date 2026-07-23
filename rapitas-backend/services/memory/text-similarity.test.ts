/**
 * text-similarity テスト
 *
 * bigram-Jaccard と近似重複ペア判定を検証: 実際に矛盾バックログを支配していた
 * 「同一教訓の言い換え」ペアが重複と判定され、無関係・真に矛盾するペアは
 * 重複と判定されないこと。
 */
import { describe, test, expect } from 'bun:test';
import {
  bigramSimilarity,
  bigramCoverage,
  isNearDuplicatePair,
  RELATED_KNOWLEDGE_MIN_COVERAGE,
} from './text-similarity';

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

describe('bigramCoverage', () => {
  test('query fully contained in target → 1', () => {
    expect(bigramCoverage('マージ競合解消', 'マージ競合解消の原則と手順')).toBe(1);
  });

  test('unrelated query vs target → below 0.1', () => {
    expect(bigramCoverage('タスク作成画面の修正', 'SQLiteの接続プール設定')).toBeLessThan(0.1);
  });

  test('long target does not collapse coverage (unlike Jaccard)', () => {
    const query = 'タスク作成画面のちらつき';
    const target =
      'タスク作成画面のちらつきは表示条件の変更で解消する。' +
      '関連ナレッジパネルは検索開始と同時に空の箱を描画し、0件応答で消滅するため、' +
      'レイアウトシフトが入力のたびに発生していた。debounce の延長だけでは主因が残る。' +
      'そのため描画条件を結果が存在するときのみに変更し、更新中は前回の結果を維持する。';
    // Jaccard collapses on long targets; coverage must stay near 1.
    expect(bigramCoverage(query, target)).toBeGreaterThan(0.9);
    expect(bigramSimilarity(query, target)).toBeLessThan(0.2);
  });

  test('empty query → 0', () => {
    expect(bigramCoverage('', 'なにかの本文')).toBe(0);
  });

  test('subject-word match passes the related-knowledge threshold, accidental overlap does not', () => {
    // Short Japanese title whose subject word appears in the entry.
    expect(
      bigramCoverage('タスク作成画面の修正', 'タスク作成画面でのバリデーション追加手順'),
    ).toBeGreaterThanOrEqual(RELATED_KNOWLEDGE_MIN_COVERAGE);
    // Overlap of a single common particle-ish bigram must stay below it.
    expect(bigramCoverage('タスク作成画面の修正', 'デプロイの曜日ルール')).toBeLessThan(
      RELATED_KNOWLEDGE_MIN_COVERAGE,
    );
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

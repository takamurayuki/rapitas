/**
 * spec-coherence-checker.test
 *
 * Fixtures are task 671's real acceptance criteria as generated, and the real
 * title of task 662 they were lifted from. Those criteria cost ten repair
 * rounds and were only rescued by a human rewriting them.
 */
import { describe, test, expect } from 'bun:test';
import {
  extractReferencedTaskIds,
  extractCoinedPhrases,
  findContaminatedCriteria,
} from './spec-coherence-checker';

const TITLE_662 =
  '[Idea] 確認済み修正不要完了を、修復ループ回数で「素直な修正不要」と「往復した末の修正不要」にさらに細分化する';

const CRITERIA_671 = [
  '修復ループ0回で完了したタスクが『素直な修正不要』として区分される',
  '修復ループ1回以上で完了したタスクが『往復した末の修正不要』として区分される',
  'タスク履歴・ダッシュボードで修復ループ回数が表示または可視化される',
  '修復ループ分類が検索・フィルタリングの対象として使用可能になる',
];

describe('extractReferencedTaskIds', () => {
  test('本文とタイトルから参照タスクを拾う', () => {
    expect(extractReferencedTaskIds('[回顧] #666 で cause=verify_repair が3回')).toEqual([666]);
  });

  test('同じIDを重複させない', () => {
    expect(extractReferencedTaskIds('#662 と #662 を比較')).toEqual([662]);
  });

  test('参照が無ければ空', () => {
    expect(extractReferencedTaskIds('通常のタイトル')).toEqual([]);
    expect(extractReferencedTaskIds(null)).toEqual([]);
  });
});

describe('extractCoinedPhrases', () => {
  test('タイトルが導入している用語を取り出す', () => {
    expect(extractCoinedPhrases(TITLE_662)).toEqual(['素直な修正不要', '往復した末の修正不要']);
  });

  test('短い引用は用語とみなさない', () => {
    // 「はい」や拡張子の引用は何も語らない。
    expect(extractCoinedPhrases('設定を「はい」にする')).toEqual([]);
  });

  test('引用の無いタイトルからは何も出ない', () => {
    expect(extractCoinedPhrases('[Bug] ログイン処理が失敗する')).toEqual([]);
  });
});

describe('findContaminatedCriteria (task 671 実データ)', () => {
  test('別タスクの用語を持ち込んだ基準を指摘する', () => {
    const hits = findContaminatedCriteria(CRITERIA_671, [{ id: 662, title: TITLE_662 }]);

    expect(hits.map((h) => h.index)).toEqual([1, 2]);
    expect(hits[0].sourceTaskId).toBe(662);
    expect(hits[0].phrases).toEqual(['素直な修正不要']);
  });

  test('用語を含まない基準は指摘しない', () => {
    // 基準3・4は #662 の話題ではあるが、造語を持ち込んでいない。
    // 造語の有無で線を引く以上、ここは通す。
    const hits = findContaminatedCriteria(CRITERIA_671, [{ id: 662, title: TITLE_662 }]);
    expect(hits.map((h) => h.index)).not.toContain(3);
  });

  test('参照タスクが無ければ何も指摘しない', () => {
    expect(findContaminatedCriteria(CRITERIA_671, [])).toEqual([]);
  });

  test('健全な仕様を誤って止めない', () => {
    // 関連タスクを引き合いに出すだけの基準は正当。造語は現れない。
    const criteria = ['#662 と同じ集計方法を使う', 'テストが全て通る'];
    expect(findContaminatedCriteria(criteria, [{ id: 662, title: TITLE_662 }])).toEqual([]);
  });
});

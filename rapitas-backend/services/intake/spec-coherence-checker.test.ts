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
  extractQuotedTaskTitles,
  findContaminatedCriteria,
  findLiftedFromQuotedTitle,
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

// 実データ: #669 は自己検出ウォッチャーが起票し、タイトルに #666 のタイトルを
// 丸ごと引用している。基準1・2は引用された #666 の成果物を述べており、
// ジャッジは「差分に含まれていない」と正しく報告して差し戻し10回に至った。
const TITLE_669 =
  '[Bug] [自己検出] 反復ループ: #666「[Idea] routing-policy.ts のリスク検出部を risk-detection.ts へ分離」で cause=verify_repair が3回';

const DESC_669 =
  '## 対象タスク\n- #666「[Idea] routing-policy.ts のリスク検出部を risk-detection.ts へ分離」';

const CRITERIA_669 = [
  'リスク検出ロジックが risk-detection.ts に正しく分離されている',
  'routing-policy.ts がリスク検出部の分離後も正常に動作する',
  '60分以内に verify_repair 遷移が3回以上発生しない',
  '最新実行が stable/completed 状態に到達する',
  'テスト・検証フェーズで log_polluted_rejected が発生しない',
];

describe('extractQuotedTaskTitles', () => {
  test('引用された他タスクのタイトルをIDごとに拾う', () => {
    expect(extractQuotedTaskTitles(TITLE_669)).toEqual([
      { id: 666, title: '[Idea] routing-policy.ts のリスク検出部を risk-detection.ts へ分離' },
    ]);
  });

  test('引用が無ければ何も返さない', () => {
    expect(extractQuotedTaskTitles('#666 を参照して修正する')).toEqual([]);
    expect(extractQuotedTaskTitles(null)).toEqual([]);
  });
});

describe('findLiftedFromQuotedTitle (task 669 実データ)', () => {
  test('引用元の成果物を述べた基準だけを挙げる', () => {
    const hits = findLiftedFromQuotedTitle(CRITERIA_669, `${TITLE_669}\n${DESC_669}`);
    expect(hits.map((h) => h.index)).toEqual([1, 2]);
    expect(hits.every((h) => h.sourceTaskId === 666 && h.kind === 'quoted_title')).toBe(true);
  });

  test('本来の主題を述べた基準3-5には触れない', () => {
    const hits = findLiftedFromQuotedTitle(CRITERIA_669, `${TITLE_669}\n${DESC_669}`);
    expect(hits.some((h) => h.index >= 3)).toBe(false);
  });

  test('引用の外でも自分で挙げているファイルは自分の担当とみなす', () => {
    // 引用と同じファイルを説明本文で明示していれば、それはこのタスクの範囲。
    const own = `${TITLE_669}\nrisk-detection.ts の分離を本タスクで行う`;
    const hits = findLiftedFromQuotedTitle(CRITERIA_669, own);
    expect(hits.map((h) => h.index)).toEqual([2]);
  });

  test('引用が無いタスクは対象外', () => {
    expect(findLiftedFromQuotedTitle(CRITERIA_669, '通常のタスク')).toEqual([]);
  });
});

describe('findContaminatedCriteria — 2経路の統合', () => {
  test('引用経路の検出を基準番号順に返す', () => {
    const hits = findContaminatedCriteria(CRITERIA_669, [], `${TITLE_669}\n${DESC_669}`);
    expect(hits.map((h) => h.index)).toEqual([1, 2]);
  });

  test('同じ基準を2経路で二重に挙げない', () => {
    const criteria = ['risk-detection.ts と「素直な修正不要」を両方含む基準'];
    const hits = findContaminatedCriteria(criteria, [{ id: 662, title: TITLE_662 }], TITLE_669);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('coined_phrase');
  });

  test('ownText 未指定なら造語経路のみ動く', () => {
    expect(findContaminatedCriteria(CRITERIA_669, [])).toEqual([]);
  });
});

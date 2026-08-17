/**
 * verify-convergence テスト
 *
 * 収束判定純関数の検証（task 619 受入基準1〜4）: 同一受入基準2回指摘での
 * cutoff、task 614 実データ型 A→B→A の検出、毎回異なる指摘 A→B→C の
 * 継続（誤検出防止）、基準特定不能・不正JSON・空 criteria の fail-open。
 */
import { describe, test, expect } from 'bun:test';
import {
  parseAcceptanceCriteria,
  identifyIndictedCriteria,
  detectNonConvergence,
} from '../../services/workflow/verify-convergence';

// task 614 の実測パターンを再現するフィクスチャ（受入基準2の根拠データ）。
const CRITERIA_614 = [
  'tests/services/test-triage.test.ts のすべてのテストが成功する',
  '`detectRepeatLoop` が bounce 回数との対応関係を検証する',
];
const R1_614 =
  '受入基準1「tests/services/test-triage.test.ts のすべてのテストが成功する」が一切対応されていない。変更ファイルは incident-signature-detectors.ts とそのテストのみ';
const R2_614 =
  'detectRepeatLoop の phase_completed:* 除外が bounce 回数との対応関係を検証していない';
const R3_614 =
  '受入基準1 に対して diff は test-triage.test.ts を一切変更しておらず、失敗の元原因にも触れていない';

describe('parseAcceptanceCriteria', () => {
  test('JSON配列文字列を string[] に正規化する', () => {
    expect(parseAcceptanceCriteria('["基準A","基準B"]')).toEqual(['基準A', '基準B']);
  });

  test('生配列は文字列要素のみ通す', () => {
    expect(parseAcceptanceCriteria(['a', 1, 'b', null])).toEqual(['a', 'b']);
  });

  test('null / 空文字 / 不正JSON / 非配列JSON は [] を返す（fail-open 前提）', () => {
    expect(parseAcceptanceCriteria(null)).toEqual([]);
    expect(parseAcceptanceCriteria('')).toEqual([]);
    expect(parseAcceptanceCriteria('{broken')).toEqual([]);
    expect(parseAcceptanceCriteria('{"a":1}')).toEqual([]);
  });
});

describe('identifyIndictedCriteria', () => {
  test('番号明示（受入基準N / 基準N / acceptance criterion N）で特定する', () => {
    expect(identifyIndictedCriteria('受入基準1が未対応', CRITERIA_614)).toEqual([1]);
    expect(identifyIndictedCriteria('基準 2 のテストが無い', CRITERIA_614)).toEqual([2]);
    expect(identifyIndictedCriteria('acceptance criterion 1 is unaddressed', CRITERIA_614)).toEqual(
      [1],
    );
  });

  test('範囲外の番号（基準9など）は採用しない', () => {
    expect(identifyIndictedCriteria('受入基準9が未対応', CRITERIA_614)).toEqual([]);
  });

  test('パス様トークン（basename 引用のみでも）で特定する', () => {
    // 理由が basename しか引用しないケース（task 614 の R3 型）
    expect(
      identifyIndictedCriteria('diff は test-triage.test.ts を変更していない', CRITERIA_614),
    ).toEqual([1]);
  });

  test('バッククォート識別子で特定する', () => {
    expect(identifyIndictedCriteria('detectRepeatLoop の対応関係が未検証', CRITERIA_614)).toEqual([
      2,
    ]);
  });

  test('汎用文言のみ（番号もトークンも無し）は [] を返す', () => {
    expect(identifyIndictedCriteria('受入基準を満たしていません', CRITERIA_614)).toEqual([]);
    expect(
      identifyIndictedCriteria(
        '差分レビューのジャッジが利用できませんでした。高リスク変更のため安全側でブロックします。',
        CRITERIA_614,
      ),
    ).toEqual([]);
  });

  test('MIN_TOKEN_LEN 未満の短い識別子では一致しない（誤検出防止）', () => {
    const criteria = ['`max` を尊重する', '長い方の `veryLongIdentifier` を使う'];
    // `max` は6文字未満なのでトークン化されず、偶然の部分一致で誤特定しない
    expect(identifyIndictedCriteria('maximum の扱いが誤っている', criteria)).toEqual([]);
  });

  test('criteria が空なら常に []', () => {
    expect(identifyIndictedCriteria('受入基準1が未対応', [])).toEqual([]);
  });
});

describe('detectNonConvergence', () => {
  test('受入基準1: 同一基準が2回指摘されたら cutoff する（A→A）', () => {
    const v = detectNonConvergence(
      '受入基準1が未対応のまま',
      ['受入基準1が一切対応されていない'],
      CRITERIA_614,
    );
    expect(v.cutoff).toBe(true);
    expect(v.criterionIndex).toBe(1);
    expect(v.count).toBe(2);
  });

  test('受入基準2: A→B→A（間に別指摘を挟む task 614 実データ）で cutoff する', () => {
    const v = detectNonConvergence(R3_614, [R1_614, R2_614], CRITERIA_614);
    expect(v.cutoff).toBe(true);
    expect(v.criterionIndex).toBe(1);
    expect(v.count).toBe(2);
  });

  test('受入基準3: 毎回異なる指摘（A→B→C）は cutoff しない（最重要の誤検出防止）', () => {
    const criteria = [
      'tests/services/test-triage.test.ts のすべてのテストが成功する',
      '`detectRepeatLoop` が bounce 回数との対応関係を検証する',
      '`escalateBlockedTask` が通知を送る',
    ];
    const v = detectNonConvergence(
      'escalateBlockedTask の通知内容が誤っている',
      ['受入基準1が一切対応されていない', 'detectRepeatLoop の対応関係が未検証'],
      criteria,
    );
    expect(v.cutoff).toBe(false);
    expect(v.criterionIndex).toBeUndefined();
  });

  test('受入基準4: criteria が空なら cutoff しない（fail-open）', () => {
    const v = detectNonConvergence('受入基準1が未対応', ['受入基準1が未対応'], []);
    expect(v.cutoff).toBe(false);
  });

  test('受入基準4: 汎用文言のみの reason 群では cutoff しない（fail-open）', () => {
    const v = detectNonConvergence(
      '受入基準を満たしていません',
      ['受入基準を満たしていません', '受入基準を満たしていません'],
      CRITERIA_614,
    );
    expect(v.cutoff).toBe(false);
  });

  test('1つの reason 内で同一基準に複数回言及しても1回として数える', () => {
    const v = detectNonConvergence(
      '受入基準1と基準1（test-triage.test.ts）が両方未対応',
      [],
      CRITERIA_614,
    );
    // 過去の指摘ゼロ + 今回1件 → count 1 で cutoff しない
    expect(v.cutoff).toBe(false);
  });

  test('複数基準が2回以上のときは最小 index を返す', () => {
    const v = detectNonConvergence(
      '受入基準1と受入基準2が未対応',
      ['基準2が未対応', '基準1が未対応'],
      CRITERIA_614,
    );
    expect(v.cutoff).toBe(true);
    expect(v.criterionIndex).toBe(1);
    expect(v.count).toBe(2);
  });
});

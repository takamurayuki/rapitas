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
  resolveNonConvergenceThreshold,
  stripUndeterminableIndictments,
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
      2,
    );
    expect(v.cutoff).toBe(true);
    expect(v.criterionIndex).toBe(1);
    expect(v.count).toBe(2);
  });

  test('受入基準2: A→B→A（間に別指摘を挟む task 614 実データ）で cutoff する', () => {
    const v = detectNonConvergence(R3_614, [R1_614, R2_614], CRITERIA_614, 2);
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
      2,
    );
    expect(v.cutoff).toBe(true);
    expect(v.criterionIndex).toBe(1);
    expect(v.count).toBe(2);
  });
});

// task 666 の実測フィクスチャ: 素のファイル名だけを書いた受入基準。
// 旧トークナイザはパス区切りかドット2つを要求したため、この形の基準は
// 検出器から完全に不可視で、10回の差し戻し予算を空回りで使い切った。
const CRITERIA_666 = [
  'risk-detection.ts が作成され、リスク検出関連のロジックが正しく移行されている',
  'routing-policy.ts が300行以下になっている',
  'risk-detection.ts が300行以下になっている',
  'workflow-orchestrator.smart-router.test.ts のmockが更新されている',
  '既存テストが全て通る',
  'リスク語彙の変更差分がティア決定ロジックと無関係に審査できる',
];

describe('素のファイル名を含む受入基準 (task 666 実測)', () => {
  test('ドット1つのファイル名を書いた基準を指摘できる', () => {
    expect(
      identifyIndictedCriteria('risk-detection.ts がまだ作成されていません', CRITERIA_666),
    ).toEqual([1, 3]);
    expect(
      identifyIndictedCriteria('routing-policy.ts が依然として300行を超えています', CRITERIA_666),
    ).toEqual([2]);
  });

  test('同一理由の2回目で打ち切る（実測では10回空回りした）', () => {
    const reason = 'risk-detection.ts がまだ作成されていません';
    expect(detectNonConvergence(reason, [reason], CRITERIA_666, 2)).toEqual({
      cutoff: true,
      criterionIndex: 1,
      count: 2,
      previousCriteria: [1, 3],
      currentCriteria: [1, 3],
    });
  });

  test('ファイル名を含まない基準は依然として不可視のまま（誤検出を増やさない）', () => {
    expect(identifyIndictedCriteria('既存テストが全て通っていません', CRITERIA_666)).toEqual([]);
  });
});

describe('汎用ワークフローアーティファクト名の誤マッチ防止 (task #800/#803 実測再現)', () => {
  test('verify.md を含む受入基準は、汎用アーティファクト名では指摘されない', () => {
    const criteria = ['verify.md 保存時の repair-feedback ブロックが自己増幅ループを起こさない'];
    const reason =
      'verify.md self-contradicts: claims all tests pass while body contains failure signals (Tests 2 failed)';
    expect(identifyIndictedCriteria(reason, criteria)).toEqual([]);
  });

  test('内容の異なる2回のverify.md系差し戻しはcutoffしない（task #800 の誤検出再現）', () => {
    const criteria = ['verify.md 保存時の repair-feedback ブロックが自己増幅ループを起こさない'];
    const priorReasons = [
      'verify.md self-contradicts: claims all tests pass while body contains failure signals (Tests 2 failed)',
    ];
    const currentReason = 'verify.md explicitly marks the verification as failed.';
    expect(detectNonConvergence(currentReason, priorReasons, criteria)).toEqual({ cutoff: false });
  });

  test('バッククォート引用の verify.md もトークン化しない', () => {
    const criteria = ['`verify.md` に検証結果が記録されている'];
    const reason =
      'verify.md self-contradicts: claims all tests pass while body contains failure signals';
    expect(identifyIndictedCriteria(reason, criteria)).toEqual([]);
  });

  test.each(['plan.md', 'research.md', 'question.md'])(
    '%s も汎用アーティファクト名としてトークン化しない',
    (name) => {
      const criteria = [`${name} の内容が正しい`];
      const reason = `${name} が壊れています`;
      expect(identifyIndictedCriteria(reason, criteria)).toEqual([]);
    },
  );

  test('汎用アーティファクト名と紛らわしくない具体的なファイル名は引き続き指摘対象になる', () => {
    const criteria = [
      '`verify-self-repair-feedback.ts` の buildRepairFeedbackBlock が基準情報を含む',
    ];
    const reason = 'verify-self-repair-feedback.ts に基準情報が含まれていない';
    expect(identifyIndictedCriteria(reason, criteria)).toEqual([1]);
  });
});

describe('ファイル風トークンの誤検出防止', () => {
  test('大文字始まりの語に続く句点は拡張子として扱わない', () => {
    // 「...されている。All tests fail」のような散文でトークンを作らない。
    const criteria = ['implementation.All tests must pass'];
    expect(identifyIndictedCriteria('implementation.All tests still fail', criteria)).toEqual([]);
  });

  test('短すぎるトークンは採用しない', () => {
    // v1.2 は 4 文字で MIN_TOKEN_LEN 未満。
    expect(identifyIndictedCriteria('v1.2 が古い', ['v1.2 に更新する'])).toEqual([]);
  });

  test('パス形式は従来どおり basename でも一致する', () => {
    const criteria = ['services/workflow/risk-detection.ts を分離する'];
    expect(identifyIndictedCriteria('risk-detection.ts が未作成です', criteria)).toEqual([1]);
  });
});

describe('指摘集合の推移判定 (task 998: 996 / 995 実測再現)', () => {
  const C = [
    '基準A `alpha-one.ts`',
    '基準B `beta-two.ts`',
    '基準C `gamma-three.ts`',
    '基準D `delta-four.ts`',
    '基準E `eps-five.ts`',
    '基準F `zeta-six.ts`',
  ];
  const SIX = '基準1 基準2 基準3 基準4 基準5 基準6 が未対応';
  const THREE = '基準4 基準5 基準6 が未対応';

  test('996 相当: 6項目から3項目へ減少（基準4 は再指摘）でも cutoff しない', () => {
    // 旧実装は基準4が2回指摘された時点で cutoff=true を返していた
    expect(detectNonConvergence(THREE, [SIX], C, 2).cutoff).toBe(false);
    expect(detectNonConvergence(THREE, [SIX], C).cutoff).toBe(false);
    // 閾値 3 到達後でも集合が減っていれば継続
    expect(detectNonConvergence('基準4 基準5 が未対応', [SIX, THREE], C).cutoff).toBe(false);
  });

  test('995 相当: 同一集合 [1,2,3,5] を3回で cutoff し両集合を返す', () => {
    const r = '基準1 基準2 基準3 基準5 が未対応';
    expect(detectNonConvergence(r, [r, r], C)).toEqual({
      cutoff: true,
      criterionIndex: 1,
      count: 3,
      previousCriteria: [1, 2, 3, 5],
      currentCriteria: [1, 2, 3, 5],
    });
  });

  test('閾値到達後に集合が増加したら cutoff する', () => {
    const p = '基準1 基準2 が未対応';
    const v = detectNonConvergence('基準1 基準2 基準3 が未対応', [p, p], C);
    expect(v.cutoff).toBe(true);
    expect(v.previousCriteria).toEqual([1, 2]);
    expect(v.currentCriteria).toEqual([1, 2, 3]);
  });

  test('既定閾値 3 未満（累積2回）は同一集合でも cutoff しない', () => {
    expect(detectNonConvergence(SIX, [SIX], C).cutoff).toBe(false);
    expect(detectNonConvergence(SIX, [SIX], C, 2).cutoff).toBe(true);
  });

  test('判定不能と自己申告された行の基準は除外され、除外後に減少なら継続', () => {
    const prior = '基準1 基準2 基準3 が未対応';
    const cur = '基準1 基準2 が未対応\n基準3 は差分では判定不能（実環境の前提が未検証）';
    expect(stripUndeterminableIndictments(cur, C)).toEqual([1, 2]);
    expect(detectNonConvergence(cur, [prior, prior], C).cutoff).toBe(false);
  });

  test('判定不能行のみで構成される指摘は fail-open', () => {
    const cur = '基準1 は要確認';
    expect(detectNonConvergence(cur, [cur, cur], C).cutoff).toBe(false);
  });

  test('判定行にも現れる基準は除外しない', () => {
    expect(stripUndeterminableIndictments('基準1 が未対応\n基準1 は未検証', C)).toEqual([1]);
  });

  // task 1007 実データ（2026-09-20）: ジャッジの reasons は " / " 結合の1行で届く。
  // 別項目の「要確認:」が同じ行にあるだけで基準3の指摘まで判定不能扱いになり、
  // 4 回同じ基準3を指摘されても cutoff が一度も発火しなかった。
  test('" / " 結合された1行の理由は項目ごとに判定不能を切り分ける（task 1007）', () => {
    const r =
      '差分レビュー不合格: 基準3 の全経路ガードが不完全（force-stop 分岐にしか無い） / 要確認: 既存コードに withinHardCeiling があるか';
    expect(stripUndeterminableIndictments(r, C)).toEqual([3]);
    expect(detectNonConvergence(r, [r, r], C).cutoff).toBe(true);
  });
});

describe('resolveNonConvergenceThreshold', () => {
  test('未設定・不正値は既定 3、正の整数のみ採用', () => {
    const k = 'RAPITAS_VERIFY_NONCONVERGENCE_THRESHOLD';
    expect(resolveNonConvergenceThreshold({})).toBe(3);
    expect(resolveNonConvergenceThreshold({ [k]: '2' })).toBe(2);
    expect(resolveNonConvergenceThreshold({ [k]: '0' })).toBe(3);
    expect(resolveNonConvergenceThreshold({ [k]: 'abc' })).toBe(3);
    expect(resolveNonConvergenceThreshold({ [k]: '-1' })).toBe(3);
  });
});

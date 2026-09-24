/**
 * phase-output-validator — 引用付き差し戻し理由と、2026-09-14〜20 の実データ由来の
 * 偽陽性（task 981 / 999 の exit 1 散文、task 974 / 940 の「前提が存在しない」❌ 行）。
 * 実失敗（未実装の ❌、runner の exit 1、検証不能）は従来どおり落ちることも確認する。
 */
import { describe, expect, test } from 'bun:test';
import { validateVerify } from './phase-output-validator';
import { isRunnerExitFailureLine } from './verify-exit-signal';
import { collectNonpassingRows } from './verify-scan-text';

const doc = (body: string, verdict = '✅ 検証成功') => `# 検証レポート
## 検証結果サマリ
| 項目 | 値 |
| --- | --- |
| 全体判定 | ${verdict} |
| テスト通過率 | 4/4 (100%) |
## テスト結果
4 pass, 0 fail (exit 0)
## チェックリスト消化状況
${body}
`;

describe('isRunnerExitFailureLine — 実データ', () => {
  test('task 981: テストケース名の列挙に含まれる「無関係な exit 1・」は散文', () => {
    expect(
      isRunnerExitFailureLine(
        '| `session-resume-detector.test.ts` | 新規 | 溢れ検出・session id なし・無関係な exit 1・既存の期限切れ検出の4ケース |',
      ),
    ).toBe(false);
  });

  test('task 999: 「… は exit 1。」は git コマンドの結果説明', () => {
    expect(
      isRunnerExitFailureLine(
        '補足: `git merge-base --is-ancestor origin/develop origin/bugfix/t995` は exit 1。PR マージ後に develop が進んだためです。',
      ),
    ).toBe(false);
  });

  test('runner の終了報告は従来どおり失敗', () => {
    expect(isRunnerExitFailureLine('| ビルド | npm run build → exit 1 |')).toBe(true);
    expect(isRunnerExitFailureLine('bun test → exit 1')).toBe(true);
  });
});

describe('validateVerify — 前提が存在しない項目の ❌（task 974 / 940 実データ）', () => {
  test('「❌ 不成立」「❌ 実装対象なし」「❌ 未着手（前提不在…）」は失敗ではない', () => {
    const r = validateVerify(
      doc(
        [
          '| `EvalCorpusTask` Prisma モデルの実在 | ❌ 不成立 | schema に 0 件 |',
          '| `EvalCorpusTask.sourceTaskId` 由来記憶の想起除外ロジック実装 | ❌ 実装対象なし | 対象モデルが存在しない |',
          '| 1. KB検索呼び出し箇所でRAPITAS_EVAL_MODEを読み取り想起をブロック | ❌ 未着手（前提不在のため見送り） | 定義が存在しない |',
        ].join('\n'),
      ),
    );
    expect(r.ok).toBe(true);
  });

  test('「❌ 検証不能」は依然として落とす（検証できないものは成功ではない）', () => {
    const r = validateVerify(
      doc(
        '| 3. 評価コーパス由来タスクで記憶再生が発生しないことの検証 | ❌ 検証不能 | ハーネス不在 |',
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('self-contradicts');
  });

  test('未実装の ❌ は従来どおり落とし、理由にその行を引用する', () => {
    const r = validateVerify(
      doc('| §8 POSIX統合テスト・CI実測 | ❌ 未確認 | 該当ファイル不存在 |'),
    );
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('«§8 POSIX統合テスト・CI実測 | ❌ 未確認 | 該当ファイル不存在»');
  });
});

describe('validateVerify — 機械判定の ❌ を説明する注記（task 1058 実データ, 2026-09-24）', () => {
  const NOTE =
    '> 自動検証ゲートの「acceptance」チェックはトークン抽出の都合で受入基準文の一部を機械的にマッチできず❌2件を報告しているが、上表の実測（テスト・既存コード確認）により受入基準2・3は満たされていることを確認済み。機械判定の抽出精度の限界であり、実装上の欠落ではない。';

  test('引用行(>)の ❌ は検証者自身の判定ではない', () => {
    const r = validateVerify(doc(`| 受入基準2 | ✅ 完了 | テストで確認 |\n\n${NOTE}`));
    expect(r.ok).toBe(true);
  });

  test('引用でなくても advisory 名が 60 文字以内に先行するか、限界/欠落ではないと明記していれば失敗ではない', () => {
    const plain = NOTE.replace(/^> /, '');
    expect(validateVerify(doc(plain)).ok).toBe(true);
    expect(
      validateVerify(
        doc('自動検証の scope チェックはこの受入基準の否定形を機械的に扱えず❌1件を出力した。'),
      ).ok,
    ).toBe(true);
  });

  test('引用行でない素の ❌ 判定は従来どおり落とす', () => {
    expect(validateVerify(doc('| 受入基準2 | ❌ 未実装 | 差分なし |')).ok).toBe(false);
  });
});

describe('validateVerify — 一部失敗の理由に未達行を引用する', () => {
  test('⚠️ 行が 2 件まで引用され、全体判定の行自体は引用されない', () => {
    const body = [
      '| 項目1 | ✅ 完了 |',
      '| 項目2 | ⚠️ 未検証（CI 実測待ち） |',
      '| 項目3 | ❌ 未実装 |',
      '| 項目4 | ⚠️ 部分 |',
    ].join('\n');
    const r = validateVerify(doc(body, '⚠️ 一部失敗'));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('未達: «項目2 | ⚠️ 未検証（CI 実測待ち）» / «項目3 | ❌ 未実装»');
    expect(r.summary).not.toContain('全体判定');
  });

  test('collectNonpassingRows は判定行・見出し・引用を除外する', () => {
    const rows = collectNonpassingRows(
      doc('| 項目2 | ⚠️ 未検証 |\n> ⚠️ 一部失敗 の場合は…\n## ⚠️ 注意', '⚠️ 一部失敗'),
    );
    expect(rows).toEqual(['| 項目2 | ⚠️ 未検証 |']);
  });
});

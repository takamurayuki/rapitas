/**
 * adversarial-diff-review-verdict テスト
 *
 * 2026-09-14〜20 の実データ由来: ジャッジが「要確認:」「管轄外:」だけを理由に fail を
 * 返した判定（log-triage 944/961/983、watcher 979/997）は pass に降格し、差分内の
 * 欠陥を 1 件でも挙げた fail はそのまま残ることを検証する。
 */
import { describe, expect, test } from 'bun:test';
import {
  isNonVerdictOnlyFail,
  parseReviewVerdict,
  aggregateJuryVerdicts,
} from './adversarial-diff-review-verdict';
import { buildDiffReviewPrompt } from './adversarial-diff-review-prompt';

describe('isNonVerdictOnlyFail', () => {
  test('要確認 / 管轄外 だけの fail は非決定的', () => {
    expect(
      isNonVerdictOnlyFail('fail', [
        '要確認: 既存コードに withinHardCeiling があるか',
        '管轄外: 受入基準1 は差分では判定できない（文書化系）',
        '管轄外：受入基準3 は差分では判定できない（実行時状態系）',
      ]),
    ).toBe(true);
  });

  test('差分内の欠陥を 1 件でも挙げていれば決定的', () => {
    expect(
      isNonVerdictOnlyFail('fail', [
        '要確認: 既存コードに withinHardCeiling があるか',
        '受入基準3: ガードが force-stop 分岐にしか入っていない',
      ]),
    ).toBe(false);
  });

  test('理由の無い fail と pass は対象外', () => {
    expect(isNonVerdictOnlyFail('fail', [])).toBe(false);
    expect(isNonVerdictOnlyFail('pass', ['要確認: x'])).toBe(false);
  });
});

describe('parseReviewVerdict — 非決定的 fail の降格', () => {
  test('task 983 型: 全理由が要確認/管轄外なら pass、理由は残す', () => {
    const r = parseReviewVerdict(
      JSON.stringify({
        verdict: 'fail',
        severity: 60,
        reasons: [
          '管轄外: 受入基準1 のログ出力箇所(ファイル:行)は差分では判定できない（文書化系）',
          '要確認: 欠陥か正常動作かの根拠はコードコメントのみ',
        ],
      }),
    );
    expect(r.verdict).toBe('pass');
    expect(r.severity).toBe(0);
    expect(r.reasons).toHaveLength(2);
    expect(r.judged).toBe(true);
  });

  test('決定的な理由を含む fail は従来どおり', () => {
    const r = parseReviewVerdict(
      '{"verdict":"fail","severity":70,"reasons":["受入基準2: 実装が差分に無い","要確認: x"]}',
    );
    expect(r.verdict).toBe('fail');
    expect(r.severity).toBe(70);
  });

  test('降格した juror は多数決で pass 側に数えられる', () => {
    const a = parseReviewVerdict(
      '{"verdict":"fail","severity":50,"reasons":["管轄外: 受入基準1"]}',
    );
    const b = parseReviewVerdict('{"verdict":"pass","severity":0,"reasons":[]}');
    const agg = aggregateJuryVerdicts([
      { provider: 'claude', ...a },
      { provider: 'gemini', ...b },
    ]);
    expect(agg.verdict).toBe('pass');
  });
});

describe('buildDiffReviewPrompt — 差分で判定できない基準の管轄外ルール', () => {
  test('実測系・文書化系・実行時状態系を管轄外として明示する', () => {
    const p = buildDiffReviewPrompt({
      taskTitle: 't',
      planContent: '',
      acceptanceCriteria: ['a'],
      diffText: '+x',
    });
    expect(p).toContain('差分だけでは原理的に判定できない受入基準も管轄外');
    expect(p).toContain('管轄外: 受入基準N は差分では判定できない');
    expect(p).toContain(
      'すべての reasons が「要確認:」「管轄外:」だけになるなら verdict は "pass"',
    );
  });
});

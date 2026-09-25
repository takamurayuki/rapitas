/**
 * verify-repeat-evidence テスト
 *
 * task 914 の実データ（同じ ❌ 行で 16 回差し戻し）と task 973（同じ ⚠️ 集合で
 * 10 回）の形を再現し、引用付き理由の同一反復だけが cutoff になること、
 * 引用の無い汎用理由や内容の変わる指摘は fail-open のままであることを検証する。
 */
import { describe, expect, test } from 'bun:test';
import {
  quoteEvidenceLine,
  extractRepeatKey,
  detectRepeatedEvidence,
} from './verify-repeat-evidence';

const ROW_914 = '| §8 POSIX統合テスト・CI実測 | ❌ 未確認 | 該当ファイル不存在 |';
const REASON_914 =
  `verify.md self-contradicts: claims all tests pass while body contains failure signals (❌ ${quoteEvidenceLine(ROW_914)}). ` +
  'Verifier likely hallucinated success — re-run with stricter test-honesty prompt.';
const LEGACY_REASON =
  'verify.md self-contradicts: claims all tests pass while body contains failure signals (❌). Verifier likely hallucinated success — re-run with stricter test-honesty prompt.';

describe('quoteEvidenceLine', () => {
  test('表の縁と空白の揺れを正規化し «…» で囲む', () => {
    expect(quoteEvidenceLine('|  §8 POSIX統合テスト   | ❌ 未確認 |')).toBe(
      '«§8 POSIX統合テスト | ❌ 未確認»',
    );
    expect(quoteEvidenceLine(ROW_914)).toBe(
      quoteEvidenceLine(`  ${ROW_914.replace(/ \| /g, '  |  ')}  `),
    );
  });

  test('空行は空文字、長い行は切り詰める', () => {
    expect(quoteEvidenceLine('   ')).toBe('');
    expect(quoteEvidenceLine('x'.repeat(500)).length).toBe(122);
  });
});

describe('extractRepeatKey', () => {
  test('引用付き理由からは引用部分だけを鍵にする', () => {
    expect(extractRepeatKey(REASON_914)).toBe(
      '§8 POSIX統合テスト・CI実測 | ❌ 未確認 | 該当ファイル不存在',
    );
  });

  test('引用の無い旧形式の理由は null（同一とみなさない）', () => {
    expect(extractRepeatKey(LEGACY_REASON)).toBeNull();
    expect(extractRepeatKey('受入基準1が満たされていない')).toBeNull();
  });

  test('一部失敗の複数引用は順序を保って結合する', () => {
    const reason =
      'verify.md explicitly reports a failed or partial overall verdict; repair is required. 未達: «項目A ⚠️» / «項目B ❌»';
    expect(extractRepeatKey(reason)).toBe('項目A ⚠️\n項目B ❌');
  });
});

describe('detectRepeatedEvidence', () => {
  test('task 914: 同じ ❌ 行が閾値回続けば cutoff', () => {
    const v = detectRepeatedEvidence(REASON_914, [REASON_914, REASON_914], 3);
    expect(v.cutoff).toBe(true);
    expect(v.count).toBe(3);
    expect(v.repeatedEvidence).toContain('POSIX統合テスト');
  });

  test('閾値未満なら差し戻しを続ける', () => {
    expect(detectRepeatedEvidence(REASON_914, [REASON_914], 3).cutoff).toBe(false);
  });

  test('指摘行が変わっていれば進捗とみなし cutoff しない（A→B→C）', () => {
    const other = (row: string) =>
      `verify.md self-contradicts: claims all tests pass while body contains failure signals (❌ ${quoteEvidenceLine(row)}).`;
    const v = detectRepeatedEvidence(
      REASON_914,
      [other('| 項目1 | ❌ 未実装 |'), other('| 項目2 | ❌ 未実装 |')],
      3,
    );
    expect(v.cutoff).toBe(false);
  });

  test('引用の無い汎用理由は何回続いても fail-open', () => {
    expect(
      detectRepeatedEvidence(LEGACY_REASON, [LEGACY_REASON, LEGACY_REASON, LEGACY_REASON], 3)
        .cutoff,
    ).toBe(false);
  });

  test('旧形式の過去理由は同一に数えない', () => {
    expect(detectRepeatedEvidence(REASON_914, [LEGACY_REASON, LEGACY_REASON], 3).cutoff).toBe(
      false,
    );
  });
});

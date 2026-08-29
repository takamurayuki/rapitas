/**
 * Tests for verify-self-repair's feedback-block helpers.
 *
 * Focuses on the pure functions behind writeRepairFeedback: reason
 * sanitisation (no numeric failure tallies survive), marker wrapping, and
 * replace-not-stack merging — the trio that stops a past rejection from
 * poisoning the next validateVerify cycle (task 494's repair loop).
 */

import { describe, expect, test } from 'bun:test';
import {
  sanitizeRepairReason,
  buildRepairFeedbackBlock,
  mergeRepairFeedback,
  REPAIR_FEEDBACK_START,
  REPAIR_FEEDBACK_END,
} from './verify-self-repair';
import { validateVerify } from './phase-output-validator';

describe('sanitizeRepairReason', () => {
  test.each([
    'failure signals (1 failed | Tests 3 failed)',
    'verify.md self-contradicts: body contains failure signals (失敗テスト数: 3)',
    'テストが2件失敗しています',
    '失敗 ×4 が検出されました',
  ])('removes numeric failure tallies from %j', (reason) => {
    const sanitized = sanitizeRepairReason(reason);
    expect(sanitized).toContain('テスト失敗あり');
    expect(/\d+\s+failed/i.test(sanitized)).toBe(false);
    expect(/失敗\s*(?:した)?テスト\s*(?:数|件数)?\s*[:：]?\s*\d/.test(sanitized)).toBe(false);
    expect(/[×x]\s*\d/.test(sanitized)).toBe(false);
  });

  test('leaves non-count text untouched', () => {
    const reason = 'verify.md explicitly marks the verification as failed.';
    expect(sanitizeRepairReason(reason)).toBe(reason);
  });
});

describe('buildRepairFeedbackBlock', () => {
  test('wraps the block in start/end markers with a one-paragraph summary', () => {
    const block = buildRepairFeedbackBlock('claims all tests pass (Tests 3 failed)', 2);
    expect(block.startsWith(REPAIR_FEEDBACK_START)).toBe(true);
    expect(block.endsWith(REPAIR_FEEDBACK_END)).toBe(true);
    expect(block).toContain('自己修復 2 回目');
    // The sanitized reason must not re-introduce a scannable count.
    expect(/\d+\s+failed/i.test(block)).toBe(false);
  });

  // Task 727 ケース5a: verifyContent から失敗テストの file:line だけでなく、
  // 次行以降のメソッド名・エラーメッセージも抽出して含める（file:line 単独行の
  // 直後にテスト名・Error 行が続くランナー出力形式を想定）。
  test('verifyContent から失敗テストの file:line・メソッド名・エラーメッセージを抽出して含めること', () => {
    const verifyContent = [
      '## テスト結果',
      'FAIL services/workflow/__tests__/verify-self-repair.test.ts:418',
      '  identifyNonConvergence should cutoff after 2 identical causes',
      '  Error: expected true to equal false',
    ].join('\n');
    const block = buildRepairFeedbackBlock('自己矛盾を検出', 1, verifyContent);
    expect(block).toMatch(/Failed test:.*\.(test|spec)\.ts:\d+/);
    expect(block).toContain('services/workflow/__tests__/verify-self-repair.test.ts:418');
    expect(block).toContain('identifyNonConvergence should cutoff after 2 identical causes');
    expect(block).toContain('Error: expected true to equal false');
  });

  // Task 727 ケース5b: 抽出した周辺テキストからも数値集計は除去され、file:line は保持される。
  test('抽出した失敗詳細から数値集計は除去され、file:line は保持されること', () => {
    const verifyContent = 'services/foo.test.ts:99 — 3 failed while running the suite';
    const block = buildRepairFeedbackBlock('reason', 1, verifyContent);
    expect(/\d+\s+failed/i.test(block)).toBe(false);
    expect(block).toContain('services/foo.test.ts:99');
  });

  test('verifyContent が無ければ従来通り失敗詳細行を含めないこと', () => {
    const block = buildRepairFeedbackBlock('reason', 1);
    expect(block).not.toContain('Failed test:');
  });
});

describe('mergeRepairFeedback', () => {
  const passingVerify = `# 検証レポート
## 検証結果サマリ
✅ 検証成功 — 12/12 passed
## テスト結果
bun test: 12 passed, 0 failed
## チェックリスト消化状況
- [x] done`;

  test('appends the block after the existing verify content', () => {
    const merged = mergeRepairFeedback(passingVerify, buildRepairFeedbackBlock('reason', 1));
    expect(merged.startsWith('# 検証レポート')).toBe(true);
    expect(merged).toContain(REPAIR_FEEDBACK_START);
  });

  test('replaces (does not stack) a previous feedback block', () => {
    const first = mergeRepairFeedback(passingVerify, buildRepairFeedbackBlock('first', 1));
    const second = mergeRepairFeedback(first, buildRepairFeedbackBlock('second', 2));
    expect(second.match(/repair-feedback:start/g)?.length).toBe(1);
    expect(second).toContain('自己修復 2 回目');
    expect(second).not.toContain('自己修復 1 回目');
  });

  test('uses the block alone when there is no prior content', () => {
    const merged = mergeRepairFeedback('', buildRepairFeedbackBlock('reason', 1));
    expect(merged.startsWith(REPAIR_FEEDBACK_START)).toBe(true);
  });

  test('merged output with a count-bearing reason still passes validateVerify', () => {
    // End-to-end guard: feedback describing "Tests 3 failed" must not make a
    // corrected (passing) verify.md self-contradict on the NEXT validation.
    const merged = mergeRepairFeedback(
      passingVerify,
      buildRepairFeedbackBlock(
        'claims all tests pass while body contains failure signals (1 failed | Tests 3 failed)',
        1,
      ),
    );
    expect(validateVerify(merged).ok).toBe(true);
  });
});

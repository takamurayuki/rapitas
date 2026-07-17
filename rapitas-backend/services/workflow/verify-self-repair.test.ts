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

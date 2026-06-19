/**
 * Tests for phase-output-validator.
 */

import { describe, expect, test } from 'bun:test';
import { validatePlan, validateResearch, validateVerify } from './phase-output-validator';

describe('validatePlan', () => {
  test('rejects empty content', () => {
    const result = validatePlan('');
    expect(result.ok).toBe(false);
    expect(result.severity).toBe(100);
  });

  test('rejects plan missing 設計判断の根拠 (severity bumped to >=80)', () => {
    const planWithoutRationale = `# 実装計画
## タスク概要
foo
## 実装チェックリスト
- [ ] do thing
## 変更予定ファイル
- file.ts
## リスク
- low
## 完了条件
- works`;
    const result = validatePlan(planWithoutRationale);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toContain('設計判断の根拠');
    expect(result.severity).toBeGreaterThanOrEqual(80);
  });

  test('accepts well-formed plan with all sections', () => {
    const goodPlan = `# 実装計画
## タスク概要
abc
## 設計判断の根拠
why
## 実装チェックリスト
- [ ] step
## 変更予定ファイル
- a.ts
## リスク
- none
## 完了条件
- pass`;
    const result = validatePlan(goodPlan);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });
});

describe('validateResearch', () => {
  test('detects missing sections', () => {
    const partial = `# 調査
## 影響範囲
foo`;
    const result = validateResearch(partial);
    expect(result.ok).toBe(false);
    expect(result.missingSections.length).toBeGreaterThan(0);
  });

  test('accepts complete research with 類似実装 heading (backward compat)', () => {
    const complete = `# 調査
## 影響範囲
a
## 依存関係
b
## 類似実装
c
## リスク評価
d
## テスト戦略
e`;
    const result = validateResearch(complete);
    expect(result.ok).toBe(true);
  });

  test('accepts complete research with 類似機能 heading (current template)', () => {
    const complete = `# 調査
## 影響範囲分析
a
### 依存関係マップ
b
### 類似機能の有無
c
## リスク評価
d
## テスト戦略
e`;
    const result = validateResearch(complete);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('reports 類似機能 as the label when both alternatives are missing', () => {
    const missing = `# 調査
## 影響範囲
a
## 依存関係
b
## リスク評価
d
## テスト戦略
e`;
    const result = validateResearch(missing);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toContain('類似機能');
    expect(result.missingSections).not.toContain('類似実装');
  });

  test('returns severity=100 for empty content', () => {
    const result = validateResearch('');
    expect(result.ok).toBe(false);
    expect(result.severity).toBe(100);
  });
});

describe('validateVerify', () => {
  test('accepts complete verify', () => {
    const complete = `# 検証レポート
## 検証結果サマリ
合格
## テスト結果
all pass
## チェックリスト
- ok`;
    const result = validateVerify(complete);
    expect(result.ok).toBe(true);
  });

  test('rejects empty verify', () => {
    const result = validateVerify('');
    expect(result.ok).toBe(false);
  });

  test('flags a verify that declares ❌ 不合格 as failed (all sections present)', () => {
    // Sections are complete, so this exercises the verdict check (not the section
    // check): the verifier writes "❌ 不合格" → must be blocked, not completed.
    const failed = `# 検証レポート
## 検証結果サマリ
**❌ 不合格** — plan.md の DoD「tsc --noEmit が通る」を満たしていません。
## テスト結果
TypeScript: 1 件のエラー
## チェックリスト
- 未達`;
    expect(validateVerify(failed).ok).toBe(false);
  });

  // Regression tests for the auto_verifier WARN: lightweight mode (no plan.md) must still
  // emit the 3 required headings so validateVerify does not produce the WARN.
  test('accepts auto_verifier output with チェックリスト消化状況 heading (no plan)', () => {
    const autoVerifierOutput = `# 実装結果検証レポート
## 検証結果サマリ
全体判定: ✅ 合格
## テスト結果
bun test: 5 passed, 0 failed
## チェックリスト消化状況
| 実装内容 | 状態 |
| --- | --- |
| case auto_verifier 追加 | ✅ 完了 |`;
    const result = validateVerify(autoVerifierOutput);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('rejects verify missing チェックリスト and 検証結果サマリ group entirely', () => {
    // A verify with テスト結果 but no チェックリスト and no 検証結果サマリ synonym
    const missingBothSections = `# 実装レポート
## テスト結果
bun test: 5 passed, 0 failed
## 変更ファイル一覧
- workflow-context-builder.ts`;
    const result = validateVerify(missingBothSections);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toContain('チェックリスト');
    expect(result.missingSections).toContain('検証結果サマリ');
  });

  // OR-group synonym tests: any alternative satisfies the 検証結果サマリ requirement
  test('accepts 検証結果 (L1 heading, no サマリ) as synonym for 検証結果サマリ', () => {
    const content = `# 検証結果
## テスト結果
bun test: 3 passed
## チェックリスト
- [x] done`;
    const result = validateVerify(content);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('accepts 総合評価 heading as synonym for 検証結果サマリ', () => {
    const content = `## 総合評価
合格
## テスト結果
ok
## チェックリスト
- [x]`;
    const result = validateVerify(content);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('accepts 実装結果検証レポート heading as synonym for 検証結果サマリ', () => {
    const content = `# 実装結果検証レポート
## テスト結果
all pass
## チェックリスト
- [x] all done`;
    const result = validateVerify(content);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('still rejects verify with テスト結果 missing even when 検索結果サマリ synonym present', () => {
    const content = `## 検証レポート
summary here
## チェックリスト
- [x] done`;
    const result = validateVerify(content);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toContain('テスト結果');
  });

  test('returns severity=100 for empty verify content', () => {
    const result = validateVerify('   ');
    expect(result.ok).toBe(false);
    expect(result.severity).toBe(100);
  });

  test('detects contradiction: all-pass claim with failure signal', () => {
    const contradictory = `## 検証結果サマリ
全テスト通過
## テスト結果
1 failed
## チェックリスト
- [x]`;
    const result = validateVerify(contradictory);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe(80);
  });
});

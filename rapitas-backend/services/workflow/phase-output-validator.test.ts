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

  // NOTE: '# 実装結果検証レポート' now satisfies the 検証結果サマリ requirement via the
  // '実装結果検証' synonym. Only チェックリスト is missing in this pattern.
  test('reproduces the WARN (updated): auto_verifier output with 実装結果検証 heading passes サマリ check', () => {
    // '# 実装結果検証レポート' → matches '実装結果検証' synonym → サマリ requirement satisfied.
    // Only チェックリスト is missing.
    const missingOnlyChecklist = `# 実装結果検証レポート
## テスト結果
bun test: 5 passed, 0 failed
## 変更ファイル一覧
- workflow-context-builder.ts`;
    const result = validateVerify(missingOnlyChecklist);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toContain('チェックリスト');
    expect(result.missingSections).not.toContain('検証結果サマリ');
  });

  test('rejects verify missing both チェックリスト and 検証結果サマリ (no synonym match)', () => {
    // No heading matches any synonym for 検証結果サマリ → must fail.
    const missingBothSections = `# 調査レポート
## テスト結果
bun test: 5 passed, 0 failed
## 変更ファイル一覧
- workflow-context-builder.ts`;
    const result = validateVerify(missingBothSections);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toContain('チェックリスト');
    expect(result.missingSections).toContain('検証結果サマリ');
  });

  // Synonym acceptance tests
  test('accepts verify with # 検証結果 heading (synonym, no サマリ suffix)', () => {
    const withKekkaOnly = `# 検証結果
## テスト結果
all pass
## チェックリスト消化状況
- ok`;
    const result = validateVerify(withKekkaOnly);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('accepts verify with ## 総合評価 heading as synonym', () => {
    const withSogohyoka = `# 検証レポート
## テスト結果
all pass
## チェックリスト
- ok
## 総合評価
✅ 合格`;
    const result = validateVerify(withSogohyoka);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('accepts verify with ## 検証レポート heading as synonym', () => {
    // '検証レポート' is a recognized synonym for 検証結果サマリ.
    const withKenshoReport = `## 検証レポート
✅ 合格
## テスト結果
pass
## チェックリスト
- ok`;
    const result = validateVerify(withKenshoReport);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  test('still rejects verify missing テスト結果 even when サマリ synonym present', () => {
    // AND requirement: all 3 must be satisfied.
    const missingTestResult = `## 検証結果サマリ
✅ 合格
## チェックリスト
- ok`;
    const result = validateVerify(missingTestResult);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toContain('テスト結果');
  });
});

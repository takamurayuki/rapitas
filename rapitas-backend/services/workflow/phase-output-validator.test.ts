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

  test.each([
    {
      // Regression: a bug fix for a FAILURE path (ENOENT/phantom) legitimately
      // mentions 失敗 and reports the instructed "失敗テスト数: 0". The old regex
      // matched bare "失敗テスト", wrongly blocking the task (verify_validation_failed).
      desc: 'does NOT flag an error-handling verify (✅ success, 失敗テスト数: 0)',
      content: `# 検証レポート
## 検証結果サマリ
✅ 検証成功 — phantom path で失敗テストを再現し、cmd.exe を spawn しないことを確認。
## テスト結果
bun test: 4 passed, 失敗テスト数: 0
## チェックリスト消化状況
- [x] existsSync ガード追加`,
    },
    {
      // Regression (task 267): a PASSING verify.md routinely includes the PR-gate
      // legend "全体判定が ❌ の場合のみ PR を作成しないこと。本タスクは ✅ 合格。" — a
      // CONDITIONAL. The bare /❌/ failure signal matched it and, combined with the
      // many ✅ pass claims, falsely reported a self-contradiction → verify_repair
      // ×2 → blocked. A conditional/legend ❌ must NOT count as a failure.
      desc: 'does NOT flag a passing verify that contains the "❌ の場合" PR-gate legend',
      content: `# 実装結果検証レポート
## 検証結果サマリ
| 全体判定 | ✅ 合格 |
> ⚠️ 全体判定が ❌ の場合のみ PR を作成しないこと。本タスクは ✅ 合格。
## テスト結果
bun test: 53 passed, 0 failed
## チェックリスト消化状況
- [x] done`,
    },
    {
      // The self-repair feedback appends "...failure signals (❌)..." into verify.md;
      // that parenthetical reference must not re-trigger the contradiction gate.
      desc: 'does NOT flag a passing verify quoting the validator summary "(❌)"',
      content: `# 実装結果検証レポート
## 検証結果サマリ
✅ 合格 — 直前の差し戻し理由: claims all tests pass while body contains failure signals (❌).
## テスト結果
bun test: 10 passed, 0 failed
## チェックリスト消化状況
- [x] done`,
    },
    {
      // Regression (task 272): an honest verify documents that WHOLE-PROJECT tsc
      // exits 1 due to 2 PRE-EXISTING out-of-scope errors, written as "TSC_EXIT=1",
      // while its own scope passes. The bare /exit 1/ signal matched the identifier
      // and, with the pass claim, falsely reported a self-contradiction → blocked.
      desc: 'does NOT flag a passing verify that documents "TSC_EXIT=1" (pre-existing)',
      content: `# 検証レポート
## 検証結果サマリ
✅ 条件付き合格 — スコープ内 DoD 全達成・全テスト通過。
## テスト結果
\`\`\`
ユニット: 49/49 passed (exit 0)
TSC_EXIT=1   # プロジェクト全体tscの既存2エラー(無関係ファイル)
\`\`\`
## チェックリスト消化状況
- [x] done`,
    },
    {
      // Regression (CI-gate guard task): an honest verify PROVES the CLI guards
      // return the right code by documenting `run-gate bogus-id … exit=1` — expected
      // behaviour, written in key=value form. The old /exit[:=]?1/ matched it and,
      // with the pass claim, falsely reported a self-contradiction → verify_repair.
      desc: 'does NOT flag a passing verify that documents guard "exit=1" as evidence',
      content: `# 検証レポート
## 検証結果サマリ
✅ 検証成功（合格） — 48/48 passed
## テスト結果
\`\`\`
$ bun scripts/run-gate.ts bogus-gate
[run-gate] Unknown gate id: "bogus-gate"
exit=1
$ bun scripts/run-gate.ts
[run-gate] Usage: bun scripts/run-gate.ts <gateId>
exit=1
\`\`\`
## チェックリスト消化状況
- [x] done`,
    },
    {
      // Regression (task 376): a CI-gate verify PROVES the gate works by describing
      // expected exit codes in PROSE — "空マニフェスト(exit 1)" / "exit 1 を返す" — not
      // a runner failure. The bare /exit 1/ matched these and, with the pass claim,
      // looped the task in verify_repair → blocked despite 36/36 passing.
      desc: 'does NOT flag a passing verify that documents prose "(exit 1)" behaviour',
      content: `# 検証レポート
## 検証結果サマリ
✅ 検証成功（合格） — 36/36 passed
## テスト結果
36/36 passed。\`main()\` で --files 解釈・絞り込み。空マニフェスト(exit 1)と絞り込み空で正常終了。
不正な gate id では exit 1 を返すガードを追加。
## チェックリスト消化状況
- [x] done`,
    },
  ])('$desc', ({ content }) => {
    expect(validateVerify(content).ok).toBe(true);
  });

  test.each([
    {
      desc: 'still flags a real contradiction (✅ success but 10 tests failed)',
      content: `# 検証レポート
## 検証結果サマリ
✅ 検証成功
## テスト結果
bun test: 2 passed, 10 failed
## チェックリスト消化状況
- [x] done`,
    },
    {
      desc: 'still flags a real "exit 1" command failure on a pass-claiming verify',
      content: `# 検証レポート
## 検証結果サマリ
✅ 全テスト通過と報告
## テスト結果
bun test → exit 1
## チェックリスト消化状況
- [x] done`,
    },
    {
      // A ❌ verdict that is NOT a conditional/legend and does not assert pass on the
      // same line must still be caught (defense alongside the numeric signals).
      desc: 'still flags ❌ used as an actual verdict on its own line',
      content: `# 検証レポート
## 検証結果サマリ
✅ 全テスト通過と報告
## テスト結果
| ルートテスト | ❌ |
追加調査が必要です。
## チェックリスト消化状況
- [x] done`,
    },
  ])('$desc', ({ content }) => {
    expect(validateVerify(content).ok).toBe(false);
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
  test.each([
    {
      name: '検証結果 (L1 heading, no サマリ)',
      content: `# 検証結果
## テスト結果
bun test: 3 passed
## チェックリスト
- [x] done`,
    },
    {
      name: '総合評価',
      content: `## 総合評価
合格
## テスト結果
ok
## チェックリスト
- [x]`,
    },
    {
      name: '実装結果検証レポート',
      content: `# 実装結果検証レポート
## テスト結果
all pass
## チェックリスト
- [x] all done`,
    },
  ])('accepts $name heading as synonym for 検証結果サマリ', ({ content }) => {
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

  test('passing verify with a benign "×2" in prose is NOT a contradiction (task #304)', () => {
    // "×2" here means "two cases / twice", not "2 test failures". The old bare
    // /×\s*[1-9]\d*/ signal flagged this passing report as a hallucinated pass.
    const passing = `## 検証結果サマリ
全テスト通過 (59/59)
## テスト結果
後方互換ケース×2 を追加し、リトライ×2 のパスも確認。失敗テスト数: 0
## チェックリスト
- [x] 完了`;
    const result = validateVerify(passing);
    expect(result.ok).toBe(true);
  });

  test('a ×N attached to a failure verdict still contradicts an all-pass claim', () => {
    const contradictory = `## 検証結果サマリ
全テスト通過
## テスト結果
失敗 ×3
## チェックリスト
- [x]`;
    const result = validateVerify(contradictory);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe(80);
  });
});

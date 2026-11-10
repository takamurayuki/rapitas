/**
 * repair-cause 汎用ラベル行テスト（routing2a-fix2）
 *
 * 「- テスト: ❌ 失敗」のように、検証の種別名（テスト／E2E／build など）と判定語だけの
 * 失敗行は、何が失敗したかを述べていない要約にすぎない。これを具体的な実装失敗に
 * 数えると、同じ本文に書かれた本当の原因（Playwright 未導入など）によるインフラ障害の
 * 判定が上書きされ、不要な premium 格上げにつながる（Codex 再レビュー指摘2）。
 */
import { describe, test, expect } from 'bun:test';
import { classifyRepairCause } from './repair-cause';

/** The summary validateVerify produces for an explicit ❌ verdict (phase-output-validator.ts). */
const GENERIC_VERDICT =
  'verify.md explicitly reports a failed or partial overall verdict; repair is required.';

const kindOf = (verifyContent: string) =>
  classifyRepairCause({ reason: GENERIC_VERDICT, verifyContent }).kind;

describe('汎用ラベルだけの失敗行は、具体的な実装失敗に数えない', () => {
  test('Codex の再現: 「テスト: ❌ 失敗」＋「原因: Playwright が未導入」はインフラ障害', () => {
    const content = [
      '## 全体判定',
      '❌ 検証失敗',
      '- テスト: ❌ 失敗',
      '原因: Playwright が未導入',
    ];
    expect(kindOf(content.join('\n'))).toBe('infrastructure');
  });

  test('種別名や書式が違っても、汎用ラベル＋環境の原因ならインフラ障害', () => {
    for (const label of [
      '- E2E: ❌ 失敗',
      '| テスト | ❌ 失敗 |',
      '- E2Eテスト: ❌ 実行不可',
      '* tests: ❌ failed',
      '- 結合テスト ❌ 不合格',
      '- ビルド: ❌ 失敗',
    ]) {
      const content = ['## 全体判定', '❌ 検証失敗', label, '原因: Playwright が未導入'];
      expect(kindOf(content.join('\n'))).toBe('infrastructure');
    }
  });

  test('汎用ラベル＋要件の不備なら要件不備', () => {
    const content = ['❌ 検証失敗', '- テスト: ❌ 失敗', '原因: 受入基準2は曖昧で検証不能'];
    expect(kindOf(content.join('\n'))).toBe('requirements');
  });

  test('原因が書かれていなければ、汎用ラベルでも従来どおり能力不足', () => {
    expect(kindOf(['## 全体判定', '❌ 検証失敗', '- テスト: ❌ 失敗'].join('\n'))).toBe(
      'capability',
    );
  });
});

describe('具体的な失敗が並べば、環境の原因があっても能力不足のまま', () => {
  test('失敗したテスト名・件数が書かれた行は具体的な失敗', () => {
    for (const line of [
      '- テスト: ❌ 3件失敗（TaskList.test.tsx）',
      '- テスト: ❌ 失敗 — 保存後に一覧が更新されない',
      '| 受入基準2 | ❌ 未達 |',
      '- テスト: ❌ 2 failed',
      '| テスト | ❌ 失敗(2) |',
      '- 受入基準2の一覧更新テスト: ❌ 失敗',
    ]) {
      const content = ['❌ 検証失敗', '- E2E: ❌ 失敗', line, '原因: Playwright が未導入'];
      expect(kindOf(content.join('\n'))).toBe('capability');
    }
  });

  test('機械ゲートの要約（typecheck=NG）は汎用ラベル扱いしない', () => {
    expect(
      classifyRepairCause({
        reason: 'typecheck=NG(3) test=NG: connect ECONNREFUSED 127.0.0.1:5432',
      }).kind,
    ).toBe('capability');
  });
});

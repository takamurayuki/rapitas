/**
 * repair-cause テスト
 *
 * 差し戻し（verify_repair）の原因を「検証された能力不足／インフラ障害／要件不備／
 * 根拠不明の指摘」に分ける判定を固定する（routing2a E）。格上げに数えるのは
 * 能力不足だけ。
 */
import { describe, test, expect } from 'bun:test';
import { classifyRepairCause } from './repair-cause';

const evidenced = {
  severity: 'blocker',
  summary: 'null を返す経路で例外になる',
  evidence: 'services/foo.ts:42',
  gating: true,
};

describe('classifyRepairCause', () => {
  test('機械ゲートの不合格は検証された能力不足', () => {
    expect(classifyRepairCause({ reason: 'lint=OK typecheck=NG(3) test=NG(2)' }).kind).toBe(
      'capability',
    );
  });

  test('verify.md の自己矛盾・❌判定も能力不足', () => {
    expect(
      classifyRepairCause({ reason: '検証結果に❌があります: 受入基準2のテストが失敗' }).kind,
    ).toBe('capability');
  });

  test('枠切れ・タイムアウト・5xx はインフラ障害（格上げしない）', () => {
    for (const reason of [
      "You've hit your usage limit",
      'phase execution timeout after 1800s',
      'API Error: 529 overloaded_error',
    ]) {
      expect(classifyRepairCause({ reason }).kind).toBe('infrastructure');
    }
  });

  test('実行環境の故障もインフラ障害', () => {
    for (const reason of [
      'test=NG: connect ECONNREFUSED 127.0.0.1:5432',
      'worktree が存在しません: ENOENT',
      'test=NG: No space left on device',
      'browserType.launch: Executable doesn\'t exist — run "npx playwright install"',
    ]) {
      expect(classifyRepairCause({ reason }).kind).toBe('infrastructure');
    }
  });

  // NOTE: 陪審の差し戻しは理由文ではなく根拠つきの指摘で判定する（routing2a-fix1 項目3・4）。
  // 陪審の要件不備は repair-cause.precision.test.ts で、指摘つきで固定している。
  test('要件・計画の不備は要件不備', () => {
    for (const reason of ['受入基準2が曖昧で検証不能', 'plan.md の前提が誤り（存在しない前提）']) {
      expect(classifyRepairCause({ reason }).kind).toBe('requirements');
    }
  });

  test('根拠つきの指摘による差分レビュー不合格は能力不足', () => {
    expect(
      classifyRepairCause({
        reason: '差分レビュー不合格: null を返す経路で例外になる',
        findings: [evidenced],
      }).kind,
    ).toBe('capability');
  });

  test('根拠のない指摘だけの差分レビュー不合格は根拠不明', () => {
    expect(
      classifyRepairCause({
        reason: '差分レビュー不合格: 品質が低い',
        findings: [{ severity: 'major', summary: '品質が低い', gating: false, needsCheck: true }],
      }).kind,
    ).toBe('unfounded');
  });

  test('根拠があっても判定に使えない（minor など gating=false）指摘だけなら根拠不明', () => {
    expect(
      classifyRepairCause({
        reason: '差分レビュー不合格: 命名が分かりにくい',
        findings: [{ ...evidenced, severity: 'minor', gating: false }],
      }).kind,
    ).toBe('unfounded');
  });

  test('検証席に反証・判定不能とされた指摘は根拠不明', () => {
    for (const verification of ['refuted', 'undetermined'] as const) {
      expect(
        classifyRepairCause({
          reason: '差分レビュー不合格: null を返す経路で例外になる',
          findings: [{ ...evidenced, verification }],
        }).kind,
      ).toBe('unfounded');
    }
  });

  test('検証席が支持した指摘は能力不足', () => {
    expect(
      classifyRepairCause({
        reason: '差分レビュー不合格: null を返す経路で例外になる',
        findings: [{ ...evidenced, verification: 'holds' }],
      }).kind,
    ).toBe('capability');
  });

  test('指摘の記録が無い差分レビュー不合格は根拠不明（能力不足に数えない）', () => {
    expect(
      classifyRepairCause({ reason: '差分レビュー不合格: 受入基準を満たしていません' }).kind,
    ).toBe('unfounded');
  });

  test('理由が空なら根拠不明', () => {
    expect(classifyRepairCause({ reason: '' }).kind).toBe('unfounded');
  });
});

/**
 * repair-cause 精度テスト（routing2a-fix1 項目2・3）
 *
 * - 項目2: verify.md の判定が汎用の要約文になっても、保存済みの verify.md 本文から
 *   インフラ障害（Playwright 未導入など）を読み取り、能力不足として格上げしない。
 * - 項目3: 障害名に触れているだけの実装不具合（「429応答を処理せず」「ECONNREFUSED時の
 *   例外処理が欠落」）や、要件への違反（「受入基準2を満たせない実装」）を、
 *   インフラ障害・要件不備と取り違えない。
 */
import { describe, test, expect } from 'bun:test';
import { classifyRepairCause } from './repair-cause';

/** The summary validateVerify produces for an explicit ❌ verdict (phase-output-validator.ts). */
const GENERIC_VERDICT =
  'verify.md explicitly reports a failed or partial overall verdict; repair is required.';

const holds = (summary: string) => ({
  severity: 'blocker',
  summary,
  evidence: 'services/foo.ts:42',
  gating: true,
  verification: 'holds',
});

const jury = (summary: string) => ({
  reason: `差分レビュー不合格: ${summary}`,
  findings: [holds(summary)],
});

describe('項目2: 汎用の要約文でも verify.md 本文で原因を判定する', () => {
  const playwrightMissing = [
    '# 検証結果',
    '## 全体判定',
    '❌ 検証失敗',
    '## テスト結果',
    '| 種別 | 結果 | 備考 |',
    '|---|---|---|',
    '| unit | ✅ 42 pass / 0 failed | |',
    '| E2E | ❌ 実行不可 | Playwright が未導入のためブラウザを起動できない |',
  ].join('\n');

  test('Playwright 未導入だけが失敗の理由ならインフラ障害', () => {
    expect(
      classifyRepairCause({ reason: GENERIC_VERDICT, verifyContent: playwrightMissing }).kind,
    ).toBe('infrastructure');
  });

  test('Playwright の実行ファイル欠落（英語のエラー）もインフラ障害', () => {
    const content = [
      '## 全体判定',
      '❌ 検証失敗',
      "E2E: ❌ browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright",
    ].join('\n');
    expect(classifyRepairCause({ reason: GENERIC_VERDICT, verifyContent: content }).kind).toBe(
      'infrastructure',
    );
  });

  test('DB に接続できず検証できなかっただけならインフラ障害', () => {
    const content = [
      '## 全体判定',
      '❌ 検証失敗',
      '- integration: ❌ connect ECONNREFUSED 127.0.0.1:5432',
    ].join('\n');
    expect(classifyRepairCause({ reason: GENERIC_VERDICT, verifyContent: content }).kind).toBe(
      'infrastructure',
    );
  });

  test('環境の故障と並んで実装の失敗もあれば能力不足', () => {
    const content = `${playwrightMissing}\n| 受入基準2 | ❌ 未達 | 保存後に一覧が更新されない |`;
    expect(classifyRepairCause({ reason: GENERIC_VERDICT, verifyContent: content }).kind).toBe(
      'capability',
    );
  });

  test('汎用の要約文に実装の失敗行が引用されていれば能力不足', () => {
    expect(
      classifyRepairCause({
        reason: `${GENERIC_VERDICT} 未達: «| 受入基準2 | ❌ 未達 | 保存後に一覧が更新されない |»`,
        verifyContent:
          '## 全体判定\n❌ 検証失敗\n| 受入基準2 | ❌ 未達 | 保存後に一覧が更新されない |',
      }).kind,
    ).toBe('capability');
  });

  test('過去の差し戻しフィードバックに残る環境故障は今回の原因に数えない', () => {
    const content = [
      '<!-- repair-feedback:start -->',
      '前回: E2E ❌ Playwright が未導入',
      '<!-- repair-feedback:end -->',
      '## 全体判定',
      '❌ 検証失敗',
    ].join('\n');
    expect(classifyRepairCause({ reason: GENERIC_VERDICT, verifyContent: content }).kind).toBe(
      'capability',
    );
  });

  test('本文が無くても、要約に引用された行ごとに判定する（環境故障の引用だけで免責しない）', () => {
    expect(
      classifyRepairCause({
        reason: `${GENERIC_VERDICT} 未達: «| E2E | ❌ Playwright が未導入 |» / «| 受入基準2 | ❌ 未達 | 一覧が更新されない |»`,
      }).kind,
    ).toBe('capability');
  });

  test('ゲート要約はゲートごとに判定する（型エラーと環境故障が並べば能力不足）', () => {
    expect(
      classifyRepairCause({
        reason: 'typecheck=NG(3) test=NG: connect ECONNREFUSED 127.0.0.1:5432',
      }).kind,
    ).toBe('capability');
  });

  test('本文が無く汎用の要約文だけなら、従来どおり能力不足', () => {
    expect(classifyRepairCause({ reason: GENERIC_VERDICT }).kind).toBe('capability');
  });
});

describe('項目3: 障害名への言及と、実行環境の故障を区別する', () => {
  test('「429応答を処理せず例外になる」は根拠つきの実装不具合（能力不足）', () => {
    expect(classifyRepairCause(jury('429応答を処理せず例外になる')).kind).toBe('capability');
  });

  test('「ECONNREFUSED時の例外処理が欠落」は根拠つきの実装不具合（能力不足）', () => {
    expect(classifyRepairCause(jury('ECONNREFUSED時の例外処理が欠落')).kind).toBe('capability');
  });

  test('陪審以外の差し戻し理由でも、障害名への言及は能力不足', () => {
    for (const reason of [
      '検証結果に❌があります: 429応答を処理せず例外になる',
      '検証結果に❌があります: ECONNREFUSED時の例外処理が欠落',
      '検証結果に❌があります: rate limit時の待機が無い',
      '検証結果に❌があります: タイムアウトした時に再試行しない (timed out した時)',
    ]) {
      expect(classifyRepairCause({ reason }).kind).toBe('capability');
    }
  });

  test('陪審の指摘は環境ではなくコードの評価なので、障害名を含んでもインフラ扱いしない', () => {
    expect(
      classifyRepairCause({
        reason:
          '差分レビュー不合格: [major] 再試行ループが rate limit を超えて呼び出し続ける（根拠: a.ts:3）',
        findings: [holds('再試行ループが rate limit を超えて呼び出し続ける')],
      }).kind,
    ).toBe('capability');
  });

  test('実行環境が実際に壊れていればインフラ障害のまま', () => {
    for (const reason of [
      'test=NG: connect ECONNREFUSED 127.0.0.1:5432',
      'API Error: 529 overloaded_error',
      'HTTP 429 Too Many Requests',
    ]) {
      expect(classifyRepairCause({ reason }).kind).toBe('infrastructure');
    }
  });
});

describe('項目3: 実装の要件違反と、要件自体の不備を区別する', () => {
  test('「受入基準2を満たせない実装になっている」は能力不足', () => {
    expect(classifyRepairCause(jury('受入基準2を満たせない実装になっている')).kind).toBe(
      'capability',
    );
  });

  test('実装が仕様・受入基準と食い違うのは能力不足', () => {
    for (const summary of [
      '仕様と矛盾する値を返す',
      '受入基準2と実装が矛盾している',
      '受入基準2の実装が矛盾した状態を返す',
      '受入基準2は満たせない状態のまま',
    ]) {
      expect(classifyRepairCause(jury(summary)).kind).toBe('capability');
    }
  });

  test('要件そのものが矛盾・曖昧なら要件不備', () => {
    for (const summary of [
      '受入基準3が計画と矛盾しており実装では満たせない',
      '受入基準2は曖昧で検証不能',
      'acceptance criterion 2 is ambiguous',
    ]) {
      expect(classifyRepairCause(jury(summary)).kind).toBe('requirements');
    }
  });

  test('根拠つきの指摘に実装不具合が1件でも混じれば能力不足（実装者が直せる）', () => {
    expect(
      classifyRepairCause({
        reason: '差分レビュー不合格: 受入基準2は曖昧で検証不能 / null で例外になる',
        findings: [holds('受入基準2は曖昧で検証不能'), holds('null で例外になる')],
      }).kind,
    ).toBe('capability');
  });

  test('根拠の無い「要件不備」の主張だけでは再計画しない（根拠不明）', () => {
    expect(
      classifyRepairCause({ reason: '差分レビュー不合格: 受入基準3が計画と矛盾している' }).kind,
    ).toBe('unfounded');
  });
});

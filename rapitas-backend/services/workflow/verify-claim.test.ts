/**
 * verify-claim.test
 *
 * Drives validateVerify and checkVerifyClaim with a `json:verify-claim` block
 * and a measured job: honest prose about failures is accepted when the
 * measurement backs the claim, and every mismatch is sent back.
 */
import { describe, expect, test } from 'bun:test';
import { detectRepeatedEvidence, extractRepeatKey } from './verify-repeat-evidence';
import { validateVerify } from './phase-output-validator';
import { checkVerifyClaim, type MeasuredJob, type MeasuredVerification } from './verify-claim';

const SHA = 'a1b2c3d4e5f6';
const RUN = 'run-1542';

const claimBlock = (over: Record<string, unknown> = {}) =>
  '```json:verify-claim\n' +
  JSON.stringify({
    version: 1,
    overall: 'success',
    runId: RUN,
    sha: SHA,
    tests: { ran: true, failed: 0, passed: 42 },
    ...over,
  }) +
  '\n```';

const HONEST_PROSE = [
  '| RED 確認 | 修正を外すと 10件中9件が失敗 | 想定どおり |',
  '| 初回実行 | exit 1 | 原因を直して再実行 |',
  '| ❌ 環境に拒否され別経路で実行 | 代替手段で完了 | |',
].join('\n');

const report = (block: string, prose = HONEST_PROSE) => `# 検証レポート

## 検証結果サマリ
✅ 検証成功。全テスト通過。

## 変更ファイル
| ファイル | 種別 | 変更内容 |
| --- | --- | --- |
| a.ts | 変更 | 修正 |

## テスト結果
| カテゴリ | 結果 | 備考 |
| --- | --- | --- |
${prose}

${block}

## チェックリスト
- ✅ 実装

## 未解決の懸念
なし
`;

const job = (over: Partial<MeasuredJob> = {}): MeasuredVerification => ({
  job: {
    status: 'completed',
    ok: true,
    unverifiable: false,
    revision: SHA,
    checks: [{ name: 'test', ran: true, errorCount: 0 }],
    ...over,
  },
});

describe('validateVerify with a verify-claim block', () => {
  test('accepts honest failure history when the measured job backs a success claim', () => {
    const r = validateVerify(report(claimBlock()), undefined, job());
    expect(r.ok).toBe(true);
  });

  test('the same prose is sent back without a claim block (legacy detection)', () => {
    expect(validateVerify(report(''), undefined, job()).ok).toBe(false);
    expect(validateVerify(report('')).ok).toBe(false);
  });

  test('成功主張と実測が一致しても必須セクションの欠落は拒否する', () => {
    const r = validateVerify(claimBlock(), undefined, job());
    expect(r.ok).toBe(false);
    expect(r.missingSections).toContain('テスト結果');
    expect(r.missingSections).toContain('チェックリスト');
  });

  test.each([
    ['job missing', { job: null } as MeasuredVerification, 'job-missing'],
    ['lookup failed', { job: null, fetchError: 'db down' } as MeasuredVerification, 'job-missing'],
    ['job failed', job({ ok: false }), 'job-not-ok'],
    ['job unverifiable', job({ unverifiable: true }), 'job-not-ok'],
    ['job interrupted', job({ status: 'interrupted', ok: undefined }), 'job-not-completed'],
    ['job still running', job({ status: 'running', ok: undefined }), 'job-not-completed'],
    ['sha differs', job({ revision: 'ffffffff0000' }), 'sha-mismatch'],
    ['sha unknown', job({ revision: null }), 'sha-mismatch'],
    [
      'test not run',
      job({ checks: [{ name: 'test', ran: false, errorCount: 0 }] }),
      'count-mismatch',
    ],
    ['no test check', job({ checks: [] }), 'count-mismatch'],
    [
      'failure count',
      job({ checks: [{ name: 'test', ran: true, errorCount: 2 }] }),
      'count-mismatch',
    ],
  ])('rejects a success claim: %s', (_label, measured, code) => {
    const r = validateVerify(report(claimBlock(), 'テストは通過'), undefined, measured);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain(code);
  });

  test('rejects when no measurement was supplied at all', () => {
    const r = validateVerify(report(claimBlock(), 'テストは通過'));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('job-missing');
  });

  test('rejects a runId that differs from the job the loader returned', () => {
    // The loader looks the job up by the claimed runId; a claim naming another run finds nothing.
    const r = validateVerify(report(claimBlock({ runId: 'other' }), 'テストは通過'), undefined, {
      job: null,
    });
    expect(r.summary).toContain('job-missing');
  });

  test.each([
    ['broken JSON', '```json:verify-claim\n{oops\n```'],
    ['missing key', claimBlock({ sha: undefined })],
    ['empty sha', claimBlock({ sha: '' })],
    ['bad overall', claimBlock({ overall: 'ok' })],
    ['duplicate blocks', `${claimBlock()}\n\n${claimBlock()}`],
  ])('a malformed block is sent back, not downgraded to legacy: %s', (_label, block) => {
    const r = validateVerify(report(block, 'テストは通過'), undefined, job());
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('claim-malformed');
  });

  test('a failure claim against a passing job is a contradiction', () => {
    const verdict = checkVerifyClaim(claimBlock({ overall: 'failure' }), job());
    expect(verdict).toMatchObject({ kind: 'rejected', code: 'claim-contradicts-job' });
  });

  test('a failure claim against a failing job is left to the ordinary failure flow', () => {
    const verdict = checkVerifyClaim(claimBlock({ overall: 'failure' }), job({ ok: false }));
    expect(verdict.kind).toBe('failure-claim');
  });

  test('tests.passed is not compared with the measurement', () => {
    const r = validateVerify(
      report(claimBlock({ tests: { ran: true, failed: 0, passed: 1 } })),
      undefined,
      job(),
    );
    expect(r.ok).toBe(true);
  });

  test('first-failure history in the prose is not judged once the claim matches (F4)', () => {
    const prose = '初回は ❌ 検証失敗 だった。修正後は通過。\n| ❌ 初回 | 2 failed → 修正 | |';
    expect(validateVerify(report(claimBlock(), prose), undefined, job()).ok).toBe(true);
  });

  test('a failure claim backed by a failing job is itself a failed verdict (F5)', () => {
    const r = validateVerify(
      report(claimBlock({ overall: 'failure' }), '本文は成功と読める'),
      undefined,
      job({ ok: false }),
    );
    expect(r.ok).toBe(false);
    expect(r.severity).toBeGreaterThanOrEqual(80);
  });

  test('a claimed failure count must equal the measured one even when tests did not run (F2)', () => {
    const measured = job({ checks: [{ name: 'test', ran: false, errorCount: 0 }] });
    const bad = validateVerify(
      report(claimBlock({ tests: { ran: false, failed: 99 } }), 'x'),
      undefined,
      measured,
    );
    expect(bad.ok).toBe(false);
    expect(bad.summary).toContain('count-mismatch');
    const good = validateVerify(
      report(claimBlock({ tests: { ran: false, failed: 0 } }), 'x'),
      undefined,
      measured,
    );
    expect(good.ok).toBe(true);
  });

  test('an unclosed claim fence is malformed, not a legacy report (F3)', () => {
    const open = '```json:verify-claim\n{"version":1';
    for (const block of [open, `${claimBlock()}\n\n${open}`]) {
      const r = validateVerify(report(block, 'x'), undefined, job());
      expect(r.ok).toBe(false);
      expect(r.summary).toContain('claim-malformed');
    }
  });

  test('mentioning the fence name inside prose is not an unclosed block', () => {
    const prose = 'プロンプトの ```json:verify-claim の書き方を確認した。';
    const r = validateVerify(report(claimBlock(), prose), undefined, job());
    expect(r.ok).toBe(true);
  });

  test('a sha that only shares a prefix with the revision is rejected (exact match)', () => {
    const r = validateVerify(report(claimBlock({ sha: SHA.slice(0, 8) }), 'x'), undefined, job());
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('sha-mismatch');
  });

  test('rejections carry quoted evidence so the repeat detector can key on them (F6)', () => {
    const r = validateVerify(report(claimBlock(), 'x'), undefined, job({ ok: false }));
    expect(extractRepeatKey(r.summary)).not.toBeNull();
  });

  test('失敗主張でも具体的な未達行を引用し、同一指摘3回で反復を検出する（F6）', () => {
    const finding = '| 接続テスト | ❌ | CLIの実測受け渡しが未実装 |';
    const content = report(claimBlock({ overall: 'failure' }), finding);
    const { summary, ok } = validateVerify(content, undefined, job({ ok: false }));
    expect(ok).toBe(false);
    expect(extractRepeatKey(summary)).toContain('CLIの実測受け渡しが未実装');
    expect(detectRepeatedEvidence(summary, [summary], 3).cutoff).toBe(false);
    expect(detectRepeatedEvidence(summary, [summary, summary], 3)).toMatchObject({
      cutoff: true,
      count: 3,
    });
  });

  test('失敗主張でも未達内容が変わった場合は同一指摘として打ち切らない（F6）', () => {
    const summary = (finding: string) =>
      validateVerify(
        report(claimBlock({ overall: 'failure' }), finding),
        undefined,
        job({ ok: false }),
      ).summary;
    const before = summary('| 接続テスト | ❌ | CLIの実測受け渡しが未実装 |');
    const after = summary('| 入力検査 | ❌ | JSONの破損を誤って受理する |');
    expect(extractRepeatKey(after)).toContain('JSONの破損を誤って受理する');
    expect(detectRepeatedEvidence(after, [before, before], 3).cutoff).toBe(false);
  });

  test('本文に未達行がなくても失敗主張と実測の証拠を引用する（F6）', () => {
    const { summary } = validateVerify(
      report(claimBlock({ overall: 'failure', tests: { ran: true, failed: 2 } }), '説明のみ'),
      undefined,
      job({ ok: false, checks: [{ name: 'test', ran: true, errorCount: 2 }] }),
    );
    const key = extractRepeatKey(summary);
    expect(key).toContain('overall=failure');
    expect(key).toContain('failed=2');
    expect(detectRepeatedEvidence(summary, [summary, summary], 3).cutoff).toBe(true);
  });
});

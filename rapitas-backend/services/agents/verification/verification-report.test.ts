/**
 * verification/verification-report ユニットテスト
 *
 * renderVerificationMarkdown が判定・チェック行・詳細ブロック・既存失敗・
 * 未検証状態を正しくMarkdownへ整形することを検証する。
 */
import { describe, test, expect } from 'bun:test';
import { renderVerificationMarkdown } from './verification-report';
import type { VerificationResult, VerificationCheck } from './automated-verifier';

function makeCheck(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    name: 'lint',
    ran: true,
    ok: true,
    errorCount: 0,
    details: '',
    ...overrides,
  };
}

function makeResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    ok: true,
    changedFiles: ['a.ts', 'b.ts'],
    checks: [makeCheck()],
    summary: '',
    ...overrides,
  };
}

describe('renderVerificationMarkdown', () => {
  test('renders a passing verdict and OK check line', () => {
    const md = renderVerificationMarkdown(makeResult());
    expect(md).toContain('✅ 合格');
    expect(md).toContain('- lint: ✅ OK');
    expect(md).toContain('対象変更ファイル: 2件');
  });

  test('renders a failing verdict', () => {
    const md = renderVerificationMarkdown(makeResult({ ok: false }));
    expect(md).toContain('❌ 失敗（新規エラー検出）');
  });

  test('renders an unverifiable verdict distinctly from a failure', () => {
    const md = renderVerificationMarkdown(makeResult({ unverifiable: true }));
    expect(md).toContain('⚠️ 未検証（ツールを実行できず fail-closed）');
  });

  test('renders "対象外" for a check that did not run', () => {
    const md = renderVerificationMarkdown(makeResult({ checks: [makeCheck({ ran: false })] }));
    expect(md).toContain('- lint: 対象外');
  });

  test('renders a failing check with its error count', () => {
    const md = renderVerificationMarkdown(
      makeResult({ checks: [makeCheck({ name: 'typecheck', ok: false, errorCount: 3 })] }),
    );
    expect(md).toContain('- typecheck: ❌ 3件');
  });

  test('renders an unverifiable individual check distinctly', () => {
    const md = renderVerificationMarkdown(
      makeResult({ checks: [makeCheck({ ran: true, ok: false, unverifiable: true })] }),
    );
    expect(md).toContain('- lint: ⚠️ 未検証（ツール実行不可）');
  });

  test('includes a fenced details block only when the check failed and has details', () => {
    const md = renderVerificationMarkdown(
      makeResult({
        checks: [makeCheck({ ok: false, errorCount: 1, details: 'TS2322: type error' })],
      }),
    );
    expect(md).toContain('```\nTS2322: type error\n```');
  });

  test('omits a details block for a passing check even if details happens to be set', () => {
    const md = renderVerificationMarkdown(
      makeResult({ checks: [makeCheck({ ok: true, details: 'should not appear' })] }),
    );
    expect(md).not.toContain('should not appear');
  });

  test('lists pre-existing test failures in a separate section', () => {
    const md = renderVerificationMarkdown(
      makeResult({
        checks: [
          makeCheck({
            name: 'test',
            ok: true,
            preExistingFailures: ['some.test.ts', 'other.test.ts'],
          }),
        ],
      }),
    );
    expect(md).toContain('### ⚠️ 既存失敗（本変更とは無関係）');
    expect(md).toContain('- `some.test.ts`');
    expect(md).toContain('- `other.test.ts`');
  });

  test('omits the pre-existing-failures section when there are none', () => {
    const md = renderVerificationMarkdown(
      makeResult({ checks: [makeCheck({ name: 'test', preExistingFailures: [] })] }),
    );
    expect(md).not.toContain('既存失敗');
  });

  test('renders multiple checks in order', () => {
    const md = renderVerificationMarkdown(
      makeResult({
        checks: [
          makeCheck({ name: 'lint' }),
          makeCheck({ name: 'typecheck' }),
          makeCheck({ name: 'test' }),
        ],
      }),
    );
    const lintIdx = md.indexOf('- lint:');
    const typecheckIdx = md.indexOf('- typecheck:');
    const testIdx = md.indexOf('- test:');
    expect(lintIdx).toBeLessThan(typecheckIdx);
    expect(typecheckIdx).toBeLessThan(testIdx);
  });
});

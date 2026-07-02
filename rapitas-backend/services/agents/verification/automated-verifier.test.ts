/**
 * automated-verifier.test
 *
 * Unit tests for the verifier's pure output parsers (eslint JSON error count,
 * tsc error file extraction) and the markdown renderer. Command execution and
 * git/file I/O are integration concerns covered elsewhere.
 */
import { describe, it, expect } from 'bun:test';
import {
  parseEslintErrorCount,
  parseTscErrorFiles,
  renderVerificationMarkdown,
  type VerificationResult,
} from './automated-verifier';

describe('parseEslintErrorCount', () => {
  it('sums errorCount across files, ignoring warnings', () => {
    const json = JSON.stringify([
      { filePath: 'a.ts', errorCount: 2, warningCount: 5 },
      { filePath: 'b.ts', errorCount: 1, warningCount: 0 },
      { filePath: 'c.ts', errorCount: 0, warningCount: 3 },
    ]);
    expect(parseEslintErrorCount(json)).toEqual({ ok: true, errorCount: 3 });
  });

  it('reports ok with 0 errors for a clean run', () => {
    expect(parseEslintErrorCount('[]')).toEqual({ ok: true, errorCount: 0 });
  });

  it('flags non-JSON output as a failed run (eslint crashed)', () => {
    expect(parseEslintErrorCount('Oops: cannot find config').ok).toBe(false);
  });
});

describe('parseTscErrorFiles', () => {
  it('extracts file paths from tsc error lines and normalizes slashes', () => {
    const out = [
      'src/foo.ts(12,5): error TS2322: Type X is not assignable to Y.',
      'src\\bar.tsx(3,1): error TS2304: Cannot find name Z.',
      'src/foo.ts(40,2): error TS2345: Argument error.',
      'note: some non-error line',
      "src/baz.ts(1,1): warning TS6133: 'x' is declared but never used.", // not an error
    ].join('\n');
    expect(parseTscErrorFiles(out)).toEqual(['src/foo.ts', 'src/bar.tsx', 'src/foo.ts']);
  });

  it('returns empty for clean output', () => {
    expect(parseTscErrorFiles('')).toEqual([]);
  });
});

describe('renderVerificationMarkdown', () => {
  it.each([
    {
      name: 'renders pass/fail and embeds details only for failing checks',
      result: {
        ok: false,
        changedFiles: ['src/a.ts', 'src/b.ts'],
        checks: [
          { name: 'lint', ran: true, ok: false, errorCount: 2, details: 'eslint: 2 errors' },
          { name: 'typecheck', ran: true, ok: true, errorCount: 0, details: 'tsc ok' },
        ],
        summary: '自動検証: lint=NG(2) / typecheck=ok',
      } as VerificationResult,
      expectedContains: [
        '❌ 失敗',
        'lint: ❌ 2件',
        'eslint: 2 errors',
        'typecheck: ✅ OK',
        '対象変更ファイル: 2件',
      ],
    },
    {
      name: 'renders a failing test check (Phase ① dynamic gate)',
      result: {
        ok: false,
        changedFiles: ['src/a.ts'],
        checks: [
          { name: 'lint', ran: true, ok: true, errorCount: 0, details: 'eslint: 0 errors' },
          { name: 'typecheck', ran: true, ok: true, errorCount: 0, details: 'tsc ok' },
          {
            name: 'test',
            ran: true,
            ok: false,
            errorCount: 1,
            details: 'npm run test failed:\n1 failing',
          },
        ],
        summary: '自動検証: lint=ok / typecheck=ok / test=NG(1)',
      } as VerificationResult,
      expectedContains: ['test: ❌ 1件', 'npm run test failed'],
    },
    {
      name: 'renders an unverifiable result as fail-closed and shows its details',
      result: {
        ok: false,
        unverifiable: true,
        changedFiles: ['src/a.ts'],
        checks: [
          { name: 'lint', ran: false, ok: true, errorCount: 0, details: 'lint: not applicable' },
          {
            name: 'typecheck',
            ran: false,
            ok: false,
            errorCount: 0,
            details: 'tsconfig.json is present but the tsc binary could not be resolved.',
            unverifiable: true,
          },
        ],
        summary: '自動検証: lint=skip / typecheck=UNVERIFIED',
      } as VerificationResult,
      // details surfaced even though the check did not "run"
      expectedContains: [
        '⚠️ 未検証（ツールを実行できず fail-closed）',
        'typecheck: ⚠️ 未検証（ツール実行不可）',
        'could not be resolved',
      ],
    },
    {
      name: 'renders pre-existing failures as a separate section when present',
      result: {
        ok: true,
        changedFiles: ['src/a.ts'],
        checks: [
          {
            name: 'test',
            ran: true,
            ok: true,
            errorCount: 0,
            details: '1 test command(s): passed (2 pre-existing failure(s) excluded)',
            preExistingFailures: [
              'tests/services/idea-box-service.test.ts',
              'tests/services/other.test.ts',
            ],
          },
        ],
        summary: '自動検証: test=ok',
      } as VerificationResult,
      expectedContains: [
        '✅ 合格',
        '既存失敗（本変更とは無関係）',
        'idea-box-service.test.ts',
        '懸念バックログに起票済み',
      ],
    },
  ])('$name', ({ result, expectedContains }) => {
    const md = renderVerificationMarkdown(result);
    for (const s of expectedContains) expect(md).toContain(s);
  });

  it('does not render pre-existing section when none detected', () => {
    const result: VerificationResult = {
      ok: false,
      changedFiles: ['src/a.ts'],
      checks: [
        {
          name: 'test',
          ran: true,
          ok: false,
          errorCount: 1,
          details: 'bun test failed:\n1 failing',
        },
      ],
      summary: '自動検証: test=NG(1)',
    };
    const md = renderVerificationMarkdown(result);
    expect(md).not.toContain('既存失敗');
  });

  it('renders mixed: new failure blocks gate, pre-existing listed separately', () => {
    const result: VerificationResult = {
      ok: false,
      changedFiles: ['src/a.ts'],
      checks: [
        {
          name: 'test',
          ran: true,
          ok: false,
          errorCount: 1,
          details: 'bun test tests/services/new.test.ts failed:\n1 failing',
          preExistingFailures: ['tests/services/idea-box-service.test.ts'],
        },
      ],
      summary: '自動検証: test=NG(1)',
    };
    const md = renderVerificationMarkdown(result);
    expect(md).toContain('❌ 失敗');
    expect(md).toContain('既存失敗（本変更とは無関係）');
    expect(md).toContain('idea-box-service.test.ts');
  });
});

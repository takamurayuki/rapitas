/**
 * scope-check / related-tests テスト
 *
 * 検証ゲート強化の2本柱を検証:
 * - scope-check: plan.md のファイルリスト抽出と計画外変更の判定（パス深度の
 *   揺れ・lockfile 許容・plan 無しのスキップ）
 * - related-tests: 変更ソースから関連テストを basename 規約で発見（同階層 /
 *   __tests__ / tests ツリー、integration 除外）し scoped コマンドを構築
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parsePlanFiles, evaluateScopeCheck } from '../../services/agents/verification/scope-check';
import {
  findRelatedTestFiles,
  buildScopedTestCommand,
} from '../../services/agents/verification/related-tests';

describe('parsePlanFiles', () => {
  test('バッククォートされたパスを抽出し :line を除去すること', () => {
    const plan = [
      '# 計画',
      '- `services/github/pr-link.ts` を新規作成',
      '- `routes/social/github.ts:230` を修正',
      '- `TaskCard.tsx` も更新',
      '- ただの `code` や `npm install` は対象外',
    ].join('\n');

    const files = parsePlanFiles(plan);

    expect(files).toContain('services/github/pr-link.ts');
    expect(files).toContain('routes/social/github.ts');
    expect(files).toContain('TaskCard.tsx');
    expect(files).not.toContain('code');
    expect(files).not.toContain('npm install');
  });

  test('パスらしくないトークンは無視すること', () => {
    expect(parsePlanFiles('use `--flag` and `foo bar.ts`')).toEqual([]);
  });
});

describe('evaluateScopeCheck', () => {
  const plan = ['services/github/pr-link.ts', 'routes/social/github.ts'];

  test('plan記載のファイルのみの変更は ok になること', () => {
    const check = evaluateScopeCheck(
      ['rapitas-backend/services/github/pr-link.ts', 'routes/social/github.ts'],
      plan,
    );
    expect(check?.ok).toBe(true);
  });

  test('計画外ファイルの変更を検出して fail すること', () => {
    const check = evaluateScopeCheck(['services/github/pr-link.ts', 'src/sneaky/extra.ts'], plan);
    expect(check?.ok).toBe(false);
    expect(check?.errorCount).toBe(1);
    expect(check?.details).toContain('src/sneaky/extra.ts');
  });

  test('lockfile は常に許容されること', () => {
    const check = evaluateScopeCheck(['bun.lock', 'pnpm-lock.yaml'], plan);
    expect(check?.ok).toBe(true);
  });

  test('plan にパスが無ければ null（チェック不成立）を返すこと', () => {
    expect(evaluateScopeCheck(['anything.ts'], [])).toBeNull();
  });

  test('plan がベース名のみ（`TaskCard.tsx`）でも一致すること', () => {
    const check = evaluateScopeCheck(
      ['src/feature/tasks/components/TaskCard.tsx'],
      ['TaskCard.tsx'],
    );
    expect(check?.ok).toBe(true);
  });
});

describe('related-tests (fixture dirs)', () => {
  const root = join(tmpdir(), `rapitas-related-tests-${process.pid}`);

  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    // Layout: src/foo.ts + src/foo.test.ts, src/bar.ts + src/__tests__/bar.test.ts,
    // services/baz.ts + tests/services/baz.test.ts (+ integration to be excluded)
    mkdirSync(join(root, 'src', '__tests__'), { recursive: true });
    mkdirSync(join(root, 'services'), { recursive: true });
    mkdirSync(join(root, 'tests', 'services'), { recursive: true });
    mkdirSync(join(root, 'tests', 'integration'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }));
    writeFileSync(join(root, 'bun.lock'), '');
    writeFileSync(join(root, 'src', 'foo.ts'), '');
    writeFileSync(join(root, 'src', 'foo.test.ts'), '');
    writeFileSync(join(root, 'src', 'bar.ts'), '');
    writeFileSync(join(root, 'src', '__tests__', 'bar.test.ts'), '');
    writeFileSync(join(root, 'services', 'baz.ts'), '');
    writeFileSync(join(root, 'tests', 'services', 'baz.test.ts'), '');
    writeFileSync(join(root, 'tests', 'integration', 'baz.integration.test.ts'), '');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('同階層・__tests__・tests ツリーから関連テストを発見すること', () => {
    const related = findRelatedTestFiles(root, ['src/foo.ts', 'src/bar.ts', 'services/baz.ts']);

    expect(related).toContain('src/foo.test.ts');
    expect(related).toContain('src/__tests__/bar.test.ts');
    expect(related).toContain('tests/services/baz.test.ts');
    // integration スイートは除外（live port/DB を掴むため）
    expect(related.some((f) => f.includes('integration'))).toBe(false);
  });

  test('ソース変更のみでも関連テストで scoped コマンドが組まれること（既定ON）', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    delete process.env.RAPITAS_VERIFY_TESTS;
    try {
      const cmd = buildScopedTestCommand(root, root, ['src/foo.ts']);
      expect(cmd).toContain('bun test');
      expect(cmd).toContain('src/foo.test.ts');
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
    }
  });

  test('RAPITAS_VERIFY_TESTS=0 で無効化できること', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    process.env.RAPITAS_VERIFY_TESTS = '0';
    try {
      expect(buildScopedTestCommand(root, root, ['src/foo.ts'])).toBeNull();
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
      else delete process.env.RAPITAS_VERIFY_TESTS;
    }
  });

  test('関連テストが無ければ null（スキップ）を返すこと', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    delete process.env.RAPITAS_VERIFY_TESTS;
    try {
      writeFileSync(join(root, 'src', 'lonely.ts'), '');
      expect(buildScopedTestCommand(root, root, ['src/lonely.ts'])).toBeNull();
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
    }
  });
});

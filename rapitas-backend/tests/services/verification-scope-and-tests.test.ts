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
  buildScopedTestCommands,
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

describe('parsePlanFiles — 緩い記載の頑健化', () => {
  test('ディレクトリ指定・コマンド埋め込みパス・親ディレクトリを取り込むこと', () => {
    const plan = [
      '`services/memory/` を編集',
      '`bun test rapitas-backend/services/workflow/extract-json-array.test.ts` を実行',
      '`rapitas-backend/utils/common/extract-json-array.ts` を新規作成',
    ].join('\n');
    const files = parsePlanFiles(plan);
    expect(files).toContain('services/memory/'); // ディレクトリトークン
    expect(files).toContain('rapitas-backend/services/workflow/extract-json-array.test.ts'); // 埋め込み
    expect(files).toContain('rapitas-backend/services/workflow/'); // 埋め込みパスの親ディレクトリ
    expect(files).toContain('rapitas-backend/utils/common/extract-json-array.ts');
    expect(files).toContain('rapitas-backend/utils/common/'); // 親ディレクトリ
  });

  test('スペースを含むプローズのベース名（`foo bar.ts`）は拾わないこと', () => {
    // 区切りを持たないサブトークンはパス扱いしない（既存の挙動を維持）。
    expect(parsePlanFiles('`foo bar.ts` のような記述')).toEqual([]);
  });
});

describe('evaluateScopeCheck — 緩い plan でも計画内変更を通すこと (task 234 回帰)', () => {
  test('ディレクトリ/埋め込みパス記載で全変更ファイルが in-scope になること', () => {
    const planFiles = parsePlanFiles(
      [
        '`services/memory/` の貪欲regexを置換',
        '`utils/common/` に共通ヘルパーを作成',
        '`rapitas-backend/utils/common/extract-json-array.ts` 新規',
        '`bun test rapitas-backend/services/workflow/extract-json-array.test.ts`',
      ].join('\n'),
    );
    const changed = [
      'rapitas-backend/services/memory/idea-extractor.ts',
      'rapitas-backend/services/memory/task-knowledge-extractor.ts',
      'rapitas-backend/services/workflow/extract-json-array.ts',
      'rapitas-backend/utils/common/index.ts',
      'rapitas-backend/utils/common/extract-json-array.ts',
    ];
    const check = evaluateScopeCheck(changed, planFiles);
    expect(check?.ok).toBe(true);
  });

  test('頑健化後も全く無関係なファイルは計画外として検出すること', () => {
    const planFiles = parsePlanFiles('`services/memory/` を編集');
    const check = evaluateScopeCheck(
      [
        'rapitas-backend/services/memory/idea-extractor.ts',
        'rapitas-backend/routes/social/github.ts',
      ],
      planFiles,
    );
    expect(check?.ok).toBe(false);
    expect(check?.errorCount).toBe(1);
    expect(check?.details).toContain('routes/social/github.ts');
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

  test('ソース変更のみでも関連テストで scoped コマンドが組まれること（既定ON / ファイル毎に分離）', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    delete process.env.RAPITAS_VERIFY_TESTS;
    try {
      const cmds = buildScopedTestCommands(root, root, ['src/foo.ts']);
      // 1ファイル = 1コマンド（mock.module 汚染を避けるためプロセス分離）
      expect(cmds).not.toBeNull();
      expect(cmds!.length).toBe(1);
      expect(cmds![0]).toContain('bun test');
      expect(cmds![0]).toContain('src/foo.test.ts');
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
    }
  });

  test('複数の関連テストはファイル毎に別コマンドへ分離すること', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    delete process.env.RAPITAS_VERIFY_TESTS;
    try {
      const cmds = buildScopedTestCommands(root, root, [
        'src/foo.ts',
        'src/bar.ts',
        'services/baz.ts',
      ]);
      expect(cmds).not.toBeNull();
      // foo.test.ts / __tests__/bar.test.ts / tests/services/baz.test.ts の3本
      expect(cmds!.length).toBe(3);
      // 1コマンドに複数ファイルを束ねていないこと（各 bun test は1ファイル）
      for (const c of cmds!) {
        expect((c.match(/\.test\.ts/g) ?? []).length).toBe(1);
      }
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
    }
  });

  test('RAPITAS_VERIFY_TESTS=0 で無効化できること', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    process.env.RAPITAS_VERIFY_TESTS = '0';
    try {
      expect(buildScopedTestCommands(root, root, ['src/foo.ts'])).toBeNull();
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
      expect(buildScopedTestCommands(root, root, ['src/lonely.ts'])).toBeNull();
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
    }
  });
});

describe('related-tests — vitest (frontend) はファイルスコープ実行 / 全体スイートにしない', () => {
  // task 185 回帰: フロント(vitest/pnpm, bun.lock 無し)の1ファイル変更で
  // 全体スイートを走らせ、無関係な既存赤テストで誤NGになっていた。
  const root = join(tmpdir(), `rapitas-vitest-scope-${process.pid}`);

  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    writeFileSync(join(root, 'src', 'widget.tsx'), '');
    writeFileSync(join(root, 'src', '__tests__', 'widget.test.tsx'), '');
    writeFileSync(join(root, 'src', 'cssonly.tsx'), '');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('関連テストがある変更は scoped な vitest run を1コマンドで組むこと', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    delete process.env.RAPITAS_VERIFY_TESTS;
    try {
      const cmds = buildScopedTestCommands(root, root, ['src/widget.tsx']);
      expect(cmds).not.toBeNull();
      expect(cmds!.length).toBe(1);
      expect(cmds![0]).toContain('vitest run');
      expect(cmds![0]).toContain('pnpm exec');
      expect(cmds![0]).toContain('src/__tests__/widget.test.tsx');
      // 全体スイート(`pnpm run test`)に落ちていないこと
      expect(cmds![0]).not.toContain('run test');
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
    }
  });

  test('関連テストの無い変更は null（スキップ） — 全体スイートで誤NGにしない', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    delete process.env.RAPITAS_VERIFY_TESTS;
    try {
      // RAPITAS_VERIFY_TESTS=1 でも vitest は全体スイートに落とさない
      process.env.RAPITAS_VERIFY_TESTS = '1';
      expect(buildScopedTestCommands(root, root, ['src/cssonly.tsx'])).toBeNull();
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
      else delete process.env.RAPITAS_VERIFY_TESTS;
    }
  });

  test('RAPITAS_VERIFY_TESTS=0 で vitest も無効化できること', () => {
    const prev = process.env.RAPITAS_VERIFY_TESTS;
    process.env.RAPITAS_VERIFY_TESTS = '0';
    try {
      expect(buildScopedTestCommands(root, root, ['src/widget.tsx'])).toBeNull();
    } finally {
      if (prev !== undefined) process.env.RAPITAS_VERIFY_TESTS = prev;
      else delete process.env.RAPITAS_VERIFY_TESTS;
    }
  });
});

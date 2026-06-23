/**
 * generate-resolver-test.test
 *
 * Unit tests for the resolver test skeleton generator.
 * All functions under test are pure (string in / structure out) — no file system mocking needed.
 */
import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import {
  parseResolverFunctions,
  parsePrismaCalls,
  extractNonPrismaImports,
  buildMockBlock,
  buildTestCases,
  buildTestFile,
  checkWriteAllowed,
} from '../generate-resolver-test';

// NOTE: Construct platform-appropriate absolute paths so relativeImportPath works correctly on
// Windows (where path.sep = '\\') as well as on Linux CI (where path.sep = '/').
const fakeBase = join(import.meta.dir, '..', '..', 'services', 'core');

// ---------------------------------------------------------------------------
// parseResolverFunctions
// ---------------------------------------------------------------------------
describe('parseResolverFunctions', () => {
  test('async 関数を検出すること', () => {
    const src = `export async function resolveUser(id: number): Promise<User | null> {}`;
    const result = parseResolverFunctions(src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('resolveUser');
    expect(result[0].isAsync).toBe(true);
    expect(result[0].params).toBe('id: number');
  });

  test('sync 関数を検出すること', () => {
    const src = `export function titleMatchesTask(title: string, taskId: number): boolean {}`;
    const result = parseResolverFunctions(src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('titleMatchesTask');
    expect(result[0].isAsync).toBe(false);
    expect(result[0].params).toBe('title: string, taskId: number');
  });

  test('複数の関数を全件検出すること', () => {
    const src = `
      export async function resolveUserByEmail(email: string): Promise<User | null> {}
      export async function resolveUserByUsernameOrEmail(username: string, email: string): Promise<User | null> {}
    `;
    const result = parseResolverFunctions(src);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('resolveUserByEmail');
    expect(result[1].name).toBe('resolveUserByUsernameOrEmail');
  });

  test('async と sync の混在を正しく区別すること', () => {
    const src = `
      export function syncHelper(x: string): boolean { return true; }
      export async function asyncResolver(id: number): Promise<null> { return null; }
    `;
    const result = parseResolverFunctions(src);
    expect(result).toHaveLength(2);
    expect(result[0].isAsync).toBe(false);
    expect(result[1].isAsync).toBe(true);
  });

  test('export 関数が存在しない場合は空配列を返すこと', () => {
    const src = `const x = 1;\nfunction helper() {}`;
    expect(parseResolverFunctions(src)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parsePrismaCalls
// ---------------------------------------------------------------------------
describe('parsePrismaCalls', () => {
  test('findUnique を検出すること', () => {
    const src = `return prisma.task.findUnique({ where: { id } });`;
    const result = parsePrismaCalls(src);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ model: 'task', method: 'findUnique' });
  });

  test('findFirst を検出すること', () => {
    const src = `return prisma.user.findFirst({ where: { email } });`;
    const result = parsePrismaCalls(src);
    expect(result[0]).toEqual({ model: 'user', method: 'findFirst' });
  });

  test('findMany を検出すること', () => {
    const src = `return prisma.theme.findMany({ where: {} });`;
    const result = parsePrismaCalls(src);
    expect(result[0]).toEqual({ model: 'theme', method: 'findMany' });
  });

  test('同一 (model, method) ペアの重複を排除すること', () => {
    const src = `
      prisma.task.findUnique({ where: { id: 1 } });
      prisma.task.findUnique({ where: { id: 2 } });
    `;
    const result = parsePrismaCalls(src);
    expect(result).toHaveLength(1);
  });

  test('複数モデル/メソッドの組み合わせを全件返すこと', () => {
    const src = `
      prisma.task.findUnique({ where: { id } });
      prisma.task.findFirst({ where: { githubPrId: n } });
      prisma.theme.findMany({ where: {} });
    `;
    const result = parsePrismaCalls(src);
    expect(result).toHaveLength(3);
    expect(result.map((c) => `${c.model}.${c.method}`)).toEqual([
      'task.findUnique',
      'task.findFirst',
      'theme.findMany',
    ]);
  });

  test('Prisma 呼び出しが存在しない場合は空配列を返すこと', () => {
    const src = `export async function buildResolveAfterParse() { return {}; }`;
    expect(parsePrismaCalls(src)).toHaveLength(0);
  });

  test('同一モデルの異なるメソッドはそれぞれ独立して返すこと', () => {
    const src = `
      prisma.task.findUnique({ where: { id } });
      prisma.task.findFirst({ where: { githubPrId } });
    `;
    const result = parsePrismaCalls(src);
    expect(result).toHaveLength(2);
    expect(result[0].method).toBe('findUnique');
    expect(result[1].method).toBe('findFirst');
  });
});

// ---------------------------------------------------------------------------
// extractNonPrismaImports
// ---------------------------------------------------------------------------
describe('extractNonPrismaImports', () => {
  test('非Prismaインポートを検出すること', () => {
    const src = `
import { prisma } from '../../config/database';
import { runGhCommand } from './gh-client';
    `;
    const result = extractNonPrismaImports(src);
    expect(result).toContain('./gh-client');
  });

  test('database/logger/@prisma は除外すること', () => {
    const src = `
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
    `;
    expect(extractNonPrismaImports(src)).toHaveLength(0);
  });

  test('非Prismaインポートが無ければ空配列を返すこと', () => {
    const src = `import { prisma } from '../../config/database';`;
    expect(extractNonPrismaImports(src)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildMockBlock
// ---------------------------------------------------------------------------
describe('buildMockBlock', () => {
  test('単一モデルの mock 宣言を含むこと', () => {
    const calls = [{ model: 'user', method: 'findFirst' as const }];
    const result = buildMockBlock(calls, []);
    expect(result).toContain('mockUserFindFirst');
    expect(result).toContain('mock(() => Promise.resolve(null))');
  });

  test('複数モデルの mock 宣言を含むこと', () => {
    const calls = [
      { model: 'task', method: 'findUnique' as const },
      { model: 'theme', method: 'findMany' as const },
    ];
    const result = buildMockBlock(calls, []);
    expect(result).toContain('mockTaskFindUnique');
    expect(result).toContain('mockThemeFindMany');
    expect(result).toContain('task: { findUnique: mockTaskFindUnique }');
    expect(result).toContain('theme: { findMany: mockThemeFindMany }');
  });

  test('同一モデルの複数メソッドを同一エントリにまとめること', () => {
    const calls = [
      { model: 'task', method: 'findUnique' as const },
      { model: 'task', method: 'findFirst' as const },
    ];
    const result = buildMockBlock(calls, []);
    // Both methods should be on the same model line
    expect(result).toContain('findUnique: mockTaskFindUnique');
    expect(result).toContain('findFirst: mockTaskFindFirst');
  });

  test('HACK コメントを含むこと', () => {
    const result = buildMockBlock([], []);
    expect(result).toContain('HACK(agent)');
  });

  test('非Prismaインポートに TODO(human) マーカーを出力すること', () => {
    const result = buildMockBlock([], ['./gh-client']);
    expect(result).toContain("TODO(human): mock './gh-client'");
  });

  test('Prisma 呼び出しが無い場合でも logger モックを出力すること', () => {
    const result = buildMockBlock([], []);
    expect(result).toContain("mock.module('../../config/logger'");
  });
});

// ---------------------------------------------------------------------------
// buildTestCases
// ---------------------------------------------------------------------------
describe('buildTestCases', () => {
  const asyncFn = {
    name: 'resolveUserByEmail',
    isAsync: true,
    params: 'email: string',
  };
  const syncFn = {
    name: 'titleMatchesTask',
    isAsync: false,
    params: 'title: string, taskId: number',
  };
  const prismaCalls = [{ model: 'user', method: 'findFirst' as const }];

  test('async 関数は 4 ケースを生成すること', () => {
    const result = buildTestCases(asyncFn, prismaCalls);
    // Count test() occurrences
    const testCount = (result.match(/\btest\(/g) ?? []).length;
    expect(testCount).toBe(4);
  });

  test('sync 関数は 3 ケースを生成すること', () => {
    const result = buildTestCases(syncFn, prismaCalls);
    const testCount = (result.match(/\btest\(/g) ?? []).length;
    expect(testCount).toBe(3);
  });

  test('async 関数のテストは async キーワードを含むこと', () => {
    const result = buildTestCases(asyncFn, prismaCalls);
    expect(result).toContain('async () => {');
  });

  test('sync 関数のテストは await を含まないこと', () => {
    const result = buildTestCases(syncFn, prismaCalls);
    expect(result).not.toContain('await');
  });

  test('async 関数は DB エラーケースを含むこと', () => {
    const result = buildTestCases(asyncFn, prismaCalls);
    expect(result).toContain('DB エラー時');
    expect(result).toContain('mockRejectedValueOnce');
  });

  test('sync 関数は DB エラーケースを含まないこと', () => {
    const result = buildTestCases(syncFn, prismaCalls);
    expect(result).not.toContain('DB エラー時');
    expect(result).not.toContain('mockRejectedValueOnce');
  });

  test('Prisma 呼び出しがない sync 関数でも 3 ケースを生成すること', () => {
    const result = buildTestCases(syncFn, []);
    const testCount = (result.match(/\btest\(/g) ?? []).length;
    expect(testCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// buildTestFile
// ---------------------------------------------------------------------------
describe('buildTestFile', () => {
  const resolverFile = join(fakeBase, 'user-resolver.ts');
  const testFile = join(fakeBase, 'user-resolver.test.ts');
  const functions = [
    { name: 'resolveUserByEmail', isAsync: true, params: 'email: string' },
    {
      name: 'resolveUserByUsernameOrEmail',
      isAsync: true,
      params: 'username: string, email: string',
    },
  ];
  const prismaCalls = [{ model: 'user', method: 'findFirst' as const }];

  test('import 文を含むこと', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, [], testFile);
    expect(result).toContain("import { describe, test, expect, mock, beforeEach } from 'bun:test'");
  });

  test('動的 import で resolver を読み込むこと', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, [], testFile);
    expect(result).toContain("await import('./user-resolver')");
  });

  test('各関数の describe ブロックを含むこと', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, [], testFile);
    expect(result).toContain("describe('resolveUserByEmail'");
    expect(result).toContain("describe('resolveUserByUsernameOrEmail'");
  });

  test('ヘッダに網羅チェックリストを含むこと', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, [], testFile);
    expect(result).toContain('網羅チェックリスト');
    expect(result).toContain('① 正常系');
    expect(result).toContain('③ DBエラー系');
  });

  test('beforeEach リセットブロックを含むこと', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, [], testFile);
    expect(result).toContain('beforeEach');
    expect(result).toContain('mockReset');
  });

  test('Prisma 呼び出しが無い場合は beforeEach 呼び出しブロックを含まないこと', () => {
    const result = buildTestFile(resolverFile, functions, [], [], testFile);
    // 'beforeEach' appears in the import line; check the call block is absent
    expect(result).not.toContain('beforeEach(');
  });

  test('非Prismaインポートが有る場合はヘッダに列挙すること', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, ['./gh-client'], testFile);
    expect(result).toContain("'./gh-client'");
  });

  test('関数のエクスポート名を import に含むこと', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, [], testFile);
    expect(result).toContain('resolveUserByEmail');
    expect(result).toContain('resolveUserByUsernameOrEmail');
  });

  test('単一関数でも正常に生成すること', () => {
    const singleFn = [{ name: 'resolveUserByEmail', isAsync: true, params: 'email: string' }];
    const result = buildTestFile(resolverFile, singleFn, prismaCalls, [], testFile);
    expect(result).toContain("describe('resolveUserByEmail'");
  });

  test('相対パスが正しく計算されること (同じディレクトリ)', () => {
    const result = buildTestFile(resolverFile, functions, prismaCalls, [], testFile);
    expect(result).toContain("'./user-resolver'");
  });
});

// ---------------------------------------------------------------------------
// checkWriteAllowed
// ---------------------------------------------------------------------------
describe('checkWriteAllowed', () => {
  test('ファイルが存在せず force=false → true を返すこと', () => {
    // Use a path that certainly does not exist
    expect(checkWriteAllowed('/nonexistent/path/file.test.ts', false)).toBe(true);
  });

  test('ファイルが存在せず force=true → true を返すこと', () => {
    expect(checkWriteAllowed('/nonexistent/path/file.test.ts', true)).toBe(true);
  });

  test('ファイルが存在し force=false → false を返すこと', () => {
    // Use a file we know exists in this repo
    expect(checkWriteAllowed(import.meta.path, false)).toBe(false);
  });

  test('ファイルが存在し force=true → true を返すこと', () => {
    expect(checkWriteAllowed(import.meta.path, true)).toBe(true);
  });
});

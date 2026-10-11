/**
 * project-prisma-schema テスト
 *
 * 生成プロジェクトの Prisma 状態の読み取り（スキーマ探索・フィンガープリント・
 * クライアント有無）。実ファイルシステム上の一時ディレクトリで検証する — この層は
 * fs 依存そのものが対象であり、fs をモックすると「mock.module の export 欠落で
 * ファイルが無言停止する」罠に入る。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findPrismaSchemas,
  fingerprintSchemas,
  nearestPackageDir,
  prismaClientPresent,
} from './project-prisma-schema';

let root = '';

function write(rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prisma-schema-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findPrismaSchemas', () => {
  test('finds a workspace schema and ignores node_modules / .worktrees copies', () => {
    // The measured temporaid layout.
    write('apps/server/prisma/schema.prisma', 'datasource db { provider = "postgresql" }');
    write('node_modules/.prisma/client/schema.prisma', 'generated copy');
    write('.worktrees/task-1/apps/server/prisma/schema.prisma', 'worktree copy');
    expect(findPrismaSchemas(root)).toEqual(['apps/server/prisma/schema.prisma']);
  });

  test('reports a prismaSchemaFolder as the folder, not its files', () => {
    write('prisma/schema/user.prisma', 'model User { id Int @id }');
    write('prisma/schema/post.prisma', 'model Post { id Int @id }');
    expect(findPrismaSchemas(root)).toEqual(['prisma/schema']);
  });

  test('returns nothing when the project has no prisma at all', () => {
    write('package.json', '{}');
    expect(findPrismaSchemas(root)).toEqual([]);
  });
});

describe('fingerprintSchemas', () => {
  test('changes when a schema file changes and is stable otherwise', () => {
    write('prisma/schema.prisma', 'model A { id Int @id }');
    const before = fingerprintSchemas(root, findPrismaSchemas(root));
    expect(fingerprintSchemas(root, findPrismaSchemas(root))).toBe(before);
    write('prisma/schema.prisma', 'model A { id Int @id\n name String }');
    expect(fingerprintSchemas(root, findPrismaSchemas(root))).not.toBe(before);
  });

  test('covers every file of a schema folder', () => {
    write('prisma/schema/a.prisma', 'model A { id Int @id }');
    const before = fingerprintSchemas(root, ['prisma/schema']);
    write('prisma/schema/b.prisma', 'model B { id Int @id }');
    expect(fingerprintSchemas(root, ['prisma/schema'])).not.toBe(before);
  });

  test("is '' with no schema, so an absent prisma never looks changed", () => {
    expect(fingerprintSchemas(root, [])).toBe('');
  });
});

describe('nearestPackageDir', () => {
  test('finds the package that owns a schema', () => {
    write('package.json', '{}');
    write('apps/server/package.json', '{}');
    expect(nearestPackageDir(root, join(root, 'apps', 'server', 'prisma'))).toBe(
      join(root, 'apps', 'server'),
    );
  });

  test('falls back to the root when no package.json is above the schema', () => {
    expect(nearestPackageDir(root, join(root, 'a', 'b', 'c'))).toBe(root);
  });
});

describe('prismaClientPresent', () => {
  // Measured on the real temporaid 2026-10-11: with pnpm the client lands in
  // node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/
  // client and root node_modules/.prisma does NOT exist. Checking only the
  // hoisted path made the regenerate-skip unreachable.
  const PNPM_CLIENT = join(
    'node_modules',
    '.pnpm',
    '@prisma+client@5.20.0_prisma@5.20.0',
    'node_modules',
    '.prisma',
    'client',
  );

  test("finds pnpm's virtual-store client", () => {
    write(join(PNPM_CLIENT, 'index.js'), 'module.exports = {}');
    expect(prismaClientPresent(root, ['prisma/schema.prisma'])).toBe(true);
  });

  test('finds a hoisted client at the root', () => {
    write(join('node_modules', '.prisma', 'client', 'index.js'), 'x');
    expect(prismaClientPresent(root, ['prisma/schema.prisma'])).toBe(true);
  });

  test("finds a client beside the schema's own package", () => {
    write('package.json', '{}');
    write('apps/server/package.json', '{}');
    write(join('apps', 'server', 'node_modules', '.prisma', 'client', 'default.js'), 'x');
    expect(prismaClientPresent(root, ['apps/server/prisma/schema.prisma'])).toBe(true);
  });

  test('an empty client directory does not count — a partial generate leaves one', () => {
    mkdirSync(join(root, PNPM_CLIENT), { recursive: true });
    mkdirSync(join(root, 'node_modules', '.prisma', 'client'), { recursive: true });
    expect(prismaClientPresent(root, ['prisma/schema.prisma'])).toBe(false);
  });

  test('is false for a project with nothing installed', () => {
    expect(prismaClientPresent(root, ['prisma/schema.prisma'])).toBe(false);
  });
});

/**
 * pre-pr-base-sync-format テスト — 競合解消ファイルをパッケージ単位で prettier に渡し、
 * 整形対象外の拡張子は除外し、prettier の失敗は握りつぶして続行することを検証する。
 */
import { afterAll, beforeAll, describe, expect, test, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { formatResolvedFiles, packageRootFor } = await import('./pre-pr-base-sync-format');

let root = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'base-sync-format-'));
  mkdirSync(join(root, 'rapitas-backend', 'services', 'system'), { recursive: true });
  mkdirSync(join(root, 'rapitas-frontend', 'src'), { recursive: true });
  writeFileSync(join(root, 'rapitas-backend', 'package.json'), '{}');
  writeFileSync(join(root, 'rapitas-frontend', 'package.json'), '{}');
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('packageRootFor', () => {
  test('最寄りの package.json を持つディレクトリを返し、無ければ worktree ルート', () => {
    expect(packageRootFor(root, 'rapitas-backend/services/system/a.ts')).toBe(
      join(root, 'rapitas-backend'),
    );
    expect(packageRootFor(root, 'docs/x.md')).toBe(root);
  });
});

describe('formatResolvedFiles', () => {
  test('task 1036: 解消ファイルをパッケージごとに prettier --write へ渡す', async () => {
    const calls: Array<[string, string[]]> = [];
    const groups = await formatResolvedFiles(
      root,
      [
        'rapitas-backend/services/system/log-health-suppressions.ts',
        'rapitas-backend\\services\\system\\log-health-suppressions.test.ts',
        'rapitas-frontend/src/page.tsx',
        'rapitas-backend/prisma/schema/x.prisma',
      ],
      async (cwd, files) => {
        calls.push([cwd, files]);
      },
    );
    expect(groups[join(root, 'rapitas-backend')]).toEqual([
      'services/system/log-health-suppressions.ts',
      'services/system/log-health-suppressions.test.ts',
    ]);
    expect(groups[join(root, 'rapitas-frontend')]).toEqual(['src/page.tsx']);
    expect(calls).toHaveLength(2);
    expect(Object.values(groups).flat()).not.toContain('prisma/schema/x.prisma');
  });

  test('prettier の失敗は続行し、残りのパッケージも処理する', async () => {
    const seen: string[] = [];
    await formatResolvedFiles(
      root,
      ['rapitas-backend/a.ts', 'rapitas-frontend/b.ts'],
      async (cwd) => {
        seen.push(cwd);
        if (cwd.endsWith('rapitas-backend')) throw new Error('prettier exploded');
      },
    );
    expect(seen).toHaveLength(2);
  });
});

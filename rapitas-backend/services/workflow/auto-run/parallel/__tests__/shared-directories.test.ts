/**
 * shared-directories.test
 *
 * 2026-11-27: `rapitas-backend/services/workflow` holds 666 entries, and any two
 * tasks with a file there refused each other as "same_directory" — 3 of the 8
 * candidates that evening. A folder that large says nothing about a collision,
 * so it no longer refuses; a small folder still does.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgePair, type PairContext, type PairSide } from '../parallel-safety-rules';
import { createBroadDirectoryCheck, BROAD_DIRECTORY_MIN_ENTRIES } from '../shared-directories';

const root = mkdtempSync(join(tmpdir(), 'rapitas-broad-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, 'rapitas-backend/services/big'), { recursive: true });
mkdirSync(join(root, 'rapitas-backend/services/small'), { recursive: true });
for (let i = 0; i < BROAD_DIRECTORY_MIN_ENTRIES; i++) {
  writeFileSync(join(root, `rapitas-backend/services/big/f${i}.ts`), '');
}
writeFileSync(join(root, 'rapitas-backend/services/small/a.ts'), '');

const plan = (...files: string[]) =>
  `## 変更予定ファイル\n${files.map((f) => `- \`${f}\``).join('\n')}`;
const side = (taskId: number, files: string[]): PairSide => ({
  taskId,
  plan: plan(...files),
  description: null,
});
const ctx = (over: Partial<PairContext> = {}): PairContext => ({
  requirePlans: true,
  tableLinked: false,
  incompleteTaskIds: new Set(),
  ...over,
});

describe('broad directories', () => {
  const isBroad = createBroadDirectoryCheck(root);

  test('a folder with many entries is broad; a small one is not', () => {
    expect(isBroad('rapitas-backend/services/big')).toBe(true);
    expect(isBroad('services/big')).toBe(true);
    expect(isBroad('rapitas-backend/services/small')).toBe(false);
    expect(isBroad('rapitas-backend/does-not-exist')).toBe(false);
  });

  test('two tasks in a broad folder may run side by side', () => {
    const a = side(10, ['rapitas-backend/services/big/f1.ts']);
    const b = side(20, ['rapitas-backend/services/big/f2.ts']);
    expect(judgePair(b, a, ctx({ isBroadDirectory: isBroad }))).toEqual({ ok: true });
  });

  test('two tasks in a small folder still refuse', () => {
    const a = side(10, ['rapitas-backend/services/small/a.ts']);
    const b = side(20, ['rapitas-backend/services/small/b.ts']);
    expect(judgePair(b, a, ctx({ isBroadDirectory: isBroad }))).toMatchObject({
      reason: 'same_directory',
    });
  });
});

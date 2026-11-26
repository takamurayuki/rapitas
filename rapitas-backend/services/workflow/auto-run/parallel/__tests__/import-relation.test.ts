/**
 * import-relation.test
 *
 * Task 1552 ("近い場所"): one task's planned file importing the other task's
 * planned file is a collision. The file system is injected.
 */
import { describe, test, expect } from 'bun:test';
import { MAX_IMPORT_SCAN_FILES, findImportRelation, relativeImports } from '../import-relation';

function reader(files: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    read: async (abs: string) => {
      const key = abs.replace(/\\/g, '/').replace(/^\/repo\//, '');
      reads.push(key);
      return files[key] ?? null;
    },
  };
}

describe('findImportRelation', () => {
  test('a → b through a relative import, extension omitted', async () => {
    const r = reader({ 'pkg/src/a.ts': "import { x } from './b';\n" });
    expect(await findImportRelation('/repo', ['pkg/src/a.ts'], ['pkg/src/b.ts'], r.read)).toEqual({
      from: 'pkg/src/a.ts',
      to: 'pkg/src/b.ts',
    });
  });

  test('the reverse direction counts, and ../dir resolves to dir/index.ts', async () => {
    const r = reader({ 'pkg/src/feature/c.tsx': "const m = await import('../shared');" });
    const hit = await findImportRelation(
      '/repo',
      ['pkg/src/shared/index.ts'],
      ['pkg/src/feature/c.tsx'],
      r.read,
    );
    expect(hit).toEqual({ from: 'pkg/src/feature/c.tsx', to: 'pkg/src/shared/index.ts' });
  });

  test('no import between them → null; an unreadable (new) file is no relation', async () => {
    const r = reader({ 'pkg/a.ts': "import z from './z';" });
    expect(
      await findImportRelation('/repo', ['pkg/a.ts', 'pkg/new.ts'], ['pkg/b.ts'], r.read),
    ).toBeNull();
  });

  test(`reads at most ${MAX_IMPORT_SCAN_FILES} files per side`, async () => {
    const many = Array.from({ length: MAX_IMPORT_SCAN_FILES + 10 }, (_, i) => `pkg/f${i}.ts`);
    const r = reader({});
    await findImportRelation('/repo', many, ['pkg/target.json'], r.read);
    expect(r.reads.length).toBe(MAX_IMPORT_SCAN_FILES);
  });

  test('bare-package imports are not relative', () => {
    expect(
      relativeImports("import a from 'elysia';\nimport b from './b';\nexport * from '../c';"),
    ).toEqual(['./b', '../c']);
  });
});

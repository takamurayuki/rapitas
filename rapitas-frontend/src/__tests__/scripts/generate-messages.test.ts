/**
 * generate-messages.test
 *
 * Unit tests for the core functions exported by scripts/generate-messages.mjs.
 * Imports the script as a module (the CLI guard prevents execution on import).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeFragments } from '../../../scripts/generate-messages.mjs';

async function makeTmpDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `generate-messages-test-${Date.now()}-${Math.floor(performance.now())}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('mergeFragments', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('複数フラグメントを1つのオブジェクトへマージする', async () => {
    await writeFile(join(tmpDir, '01-common.json'), JSON.stringify({ common: { ok: 'OK' } }));
    await writeFile(join(tmpDir, '02-nav.json'), JSON.stringify({ nav: { home: 'Home' } }));
    const { merged, fileCount } = mergeFragments(tmpDir);
    expect(merged).toEqual({ common: { ok: 'OK' }, nav: { home: 'Home' } });
    expect(fileCount).toBe(2);
  });

  it('ファイル名の昇順でマージする', async () => {
    await writeFile(join(tmpDir, '02-b.json'), JSON.stringify({ b: 2 }));
    await writeFile(join(tmpDir, '01-a.json'), JSON.stringify({ a: 1 }));
    const { merged } = mergeFragments(tmpDir);
    expect(Object.keys(merged)).toEqual(['a', 'b']);
  });

  it('同一トップレベルキーが重複する場合はエラーを投げる', async () => {
    await writeFile(join(tmpDir, '01-a.json'), JSON.stringify({ agents: { x: 1 } }));
    await writeFile(join(tmpDir, '02-b.json'), JSON.stringify({ agents: { y: 2 } }));
    expect(() => mergeFragments(tmpDir)).toThrow(/duplicate top-level key "agents"/);
  });

  it('JSON以外のファイルは無視する', async () => {
    await writeFile(join(tmpDir, '01-common.json'), JSON.stringify({ common: { ok: 'OK' } }));
    await writeFile(join(tmpDir, 'README.md'), '# not json');
    const { merged, fileCount } = mergeFragments(tmpDir);
    expect(fileCount).toBe(1);
    expect(merged).toEqual({ common: { ok: 'OK' } });
  });
});

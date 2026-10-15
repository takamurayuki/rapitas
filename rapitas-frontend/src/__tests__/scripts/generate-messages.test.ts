/**
 * generate-messages.test
 *
 * Unit tests for the core functions exported by scripts/generate-messages.mjs.
 * Imports the script as a module (the CLI guard prevents execution on import).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
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

describe('生成された messages/{ja,en}.json は prettier の管理外', () => {
  // The generator writes JSON.stringify(merged, null, 2), which always expands a
  // short array; prettier collapses one that fits on a line. They disagree on
  // `dayLabels`, so `prettier --check` on the committed output can never pass.
  // Task 1105 (2026-09-26) ran that check as its own verification step, honestly
  // recorded 未検証, had the row read as a failure, and burned its cost budget
  // repeating the round; an agent that "fixed" it with `prettier --write` put
  // unrelated reformatted keys in its diff and was failed for scope drift
  // (task 1107). Dropping these entries silently restores both loops.
  it('.prettierignore が両ファイルを除外している', async () => {
    const ignore = await readFile(join(__dirname, '../../../.prettierignore'), 'utf8');
    const lines = ignore.split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('messages/ja.json');
    expect(lines).toContain('messages/en.json');
  });

  it('JSON.stringify の出力は実際に prettier と一致しない(除外の根拠)', () => {
    // The concrete disagreement, pinned so the exclusion's rationale is checkable
    // without invoking prettier: a short array is expanded, never inlined.
    const emitted = JSON.stringify({ dayLabels: ['日', '月'] }, null, 2);
    expect(emitted).toContain('\n');
    expect(emitted).not.toContain('["日", "月"]');
  });
});

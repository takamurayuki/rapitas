/**
 * sync-lucide-mock.test
 *
 * Unit tests for the core functions exported by scripts/sync-lucide-mock.mjs.
 * Imports the script as a module (the CLI guard prevents execution on import).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectUsedIcons, findNonCompliantMocks } from '../../../scripts/sync-lucide-mock.mjs';

/** Creates a temporary directory for each test. */
async function makeTmpDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `sync-lucide-mock-test-${Date.now()}-${Math.floor(performance.now())}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('collectUsedIcons', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('単一ファイルから複数アイコンを抽出できる', async () => {
    await writeFile(
      join(tmpDir, 'Component.tsx'),
      `import { Lightbulb, Plus, X } from 'lucide-react';`,
    );
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toEqual(['Lightbulb', 'Plus', 'X']);
  });

  it('複数ファイルからアイコンを収集し重複を除去する', async () => {
    await writeFile(join(tmpDir, 'A.tsx'), `import { Moon, Sun } from 'lucide-react';`);
    await writeFile(join(tmpDir, 'B.tsx'), `import { Sun, Star } from 'lucide-react';`);
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toEqual(['Moon', 'Star', 'Sun']);
  });

  it('複数行にわたる import を正しく抽出する', async () => {
    await writeFile(
      join(tmpDir, 'Multi.tsx'),
      `import {\n  AlertCircle,\n  CheckCircle,\n} from 'lucide-react';`,
    );
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toContain('AlertCircle');
    expect(icons).toContain('CheckCircle');
  });

  it('import type 構文を処理できる', async () => {
    await writeFile(
      join(tmpDir, 'Types.ts'),
      `import type { LucideIcon } from 'lucide-react';\nimport { Globe } from 'lucide-react';`,
    );
    const icons = await collectUsedIcons(tmpDir);
    // LucideIcon は `import type` のため除外。Globe は値 import なので含まれる
    expect(icons).toContain('Globe');
    expect(icons).not.toContain('LucideIcon');
  });

  it('node_modules ディレクトリを除外する', async () => {
    const nm = join(tmpDir, 'node_modules', 'some-lib');
    await mkdir(nm, { recursive: true });
    await writeFile(join(nm, 'index.ts'), `import { InternalIcon } from 'lucide-react';`);
    await writeFile(join(tmpDir, 'Real.tsx'), `import { RealIcon } from 'lucide-react';`);
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toEqual(['RealIcon']);
    expect(icons).not.toContain('InternalIcon');
  });

  it('__generated__ ディレクトリを除外する', async () => {
    const gen = join(tmpDir, '__generated__');
    await mkdir(gen, { recursive: true });
    await writeFile(join(gen, 'generated.ts'), `import { GeneratedIcon } from 'lucide-react';`);
    await writeFile(join(tmpDir, 'Real.tsx'), `import { UsedIcon } from 'lucide-react';`);
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toEqual(['UsedIcon']);
    expect(icons).not.toContain('GeneratedIcon');
  });

  it('lucide-react 以外の import を無視する', async () => {
    await writeFile(
      join(tmpDir, 'Other.tsx'),
      `import { useState } from 'react';\nimport { Pencil } from 'lucide-react';`,
    );
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toEqual(['Pencil']);
    expect(icons).not.toContain('useState');
  });

  it('ソート済み配列を返す', async () => {
    await writeFile(join(tmpDir, 'Z.tsx'), `import { Zap } from 'lucide-react';`);
    await writeFile(join(tmpDir, 'A.tsx'), `import { ArrowLeft } from 'lucide-react';`);
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toEqual([...icons].sort());
  });

  it('ファイルが存在しない場合は空配列を返す', async () => {
    const icons = await collectUsedIcons(tmpDir);
    expect(icons).toEqual([]);
  });
});

describe('findNonCompliantMocks', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('静的モックを持つファイルを検出する', async () => {
    await writeFile(
      join(tmpDir, 'Static.test.tsx'),
      `vi.mock('lucide-react', () => ({ X: () => <div /> }));`,
    );
    const violations = await findNonCompliantMocks(tmpDir);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain('Static.test.tsx');
  });

  it('buildLucideMock を使うファイルは検出しない（準拠）', async () => {
    await writeFile(
      join(tmpDir, 'Compliant.test.tsx'),
      `vi.mock('lucide-react', async (importOriginal) => {\n` +
        `  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');\n` +
        `  return buildLucideMock(importOriginal, {});\n` +
        `});`,
    );
    const violations = await findNonCompliantMocks(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it('lucide-react の mock を持たないファイルは無視する', async () => {
    await writeFile(
      join(tmpDir, 'Other.test.tsx'),
      `vi.mock('some-other-lib', () => ({ Foo: vi.fn() }));`,
    );
    const violations = await findNonCompliantMocks(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it('複数の違反ファイルを全て報告する', async () => {
    await writeFile(
      join(tmpDir, 'ViolA.test.tsx'),
      `vi.mock('lucide-react', () => ({ A: () => <div /> }));`,
    );
    await writeFile(
      join(tmpDir, 'ViolB.test.tsx'),
      `vi.mock("lucide-react", () => ({ B: () => <div /> }));`,
    );
    const violations = await findNonCompliantMocks(tmpDir);
    expect(violations.length).toBe(2);
  });
});

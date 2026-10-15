/**
 * generate-agents-panels.test
 *
 * Unit tests for the core functions exported by scripts/generate-agents-panels.mjs.
 * Imports the script as a module (the CLI guard prevents execution on import).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverPanels, renderRegistry } from '../../../scripts/generate-agents-panels.mjs';

async function makeTmpDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `generate-agents-panels-test-${Date.now()}-${Math.floor(performance.now())}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

function panelSource(id: string, order: number) {
  return (
    `import type { PanelMeta } from './panel-types';\n` +
    `export const panelMeta: PanelMeta = { id: '${id}', order: ${order} };\n` +
    `export function Foo() { return null; }\n`
  );
}

describe('discoverPanels', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('order 昇順、同値は id 昇順でソートする', async () => {
    await writeFile(join(tmpDir, 'ZPanel.tsx'), panelSource('z', 10));
    await writeFile(join(tmpDir, 'APanel.tsx'), panelSource('a', 10));
    await writeFile(join(tmpDir, 'FirstPanel.tsx'), panelSource('first', 0));
    const panels = discoverPanels(tmpDir);
    expect(panels.map((p) => p.id)).toEqual(['first', 'a', 'z']);
  });

  it('panelMeta を export しないファイルは無視される', async () => {
    await writeFile(join(tmpDir, 'OnePanel.tsx'), panelSource('one', 0));
    await writeFile(join(tmpDir, 'NoMetaPanel.tsx'), `export function NoMeta() { return null; }`);
    const panels = discoverPanels(tmpDir);
    expect(panels).toHaveLength(1);
    expect(panels[0].id).toBe('one');
  });

  it('Panel.tsx で終わらないファイルは無視される', async () => {
    await writeFile(join(tmpDir, 'OnePanel.tsx'), panelSource('one', 0));
    await writeFile(join(tmpDir, 'helpers.ts'), panelSource('two', 0));
    const panels = discoverPanels(tmpDir);
    expect(panels).toHaveLength(1);
  });

  it('id が重複する場合はエラーを投げる', async () => {
    await writeFile(join(tmpDir, 'OnePanel.tsx'), panelSource('dup', 0));
    await writeFile(join(tmpDir, 'TwoPanel.tsx'), panelSource('dup', 10));
    expect(() => discoverPanels(tmpDir)).toThrow(/duplicate panel id "dup"/);
  });
});

describe('renderRegistry', () => {
  it('import 文と AGENTS_PANELS 配列を生成する', () => {
    const out = renderRegistry([
      { id: 'a', componentName: 'APanel' },
      { id: 'b', componentName: 'BPanel' },
    ]);
    expect(out).toContain("import { APanel } from './APanel';");
    expect(out).toContain("import { BPanel } from './BPanel';");
    expect(out).toContain("{ id: 'a', Component: APanel },");
    expect(out).toContain("{ id: 'b', Component: BPanel },");
  });
});

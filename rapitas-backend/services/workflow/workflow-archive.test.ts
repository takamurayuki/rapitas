/**
 * workflow-archive.test
 *
 * archiveWorkflowFile moves a rejected artifact out of the workflow dir so a
 * later phase regenerates instead of reusing it (the plan-invalid replan loop).
 */
import { describe, test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { archiveWorkflowFile } from './workflow-file-utils';

async function tempWorkflowDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'wf-archive-'));
  await mkdir(base, { recursive: true });
  return base;
}

describe('archiveWorkflowFile', () => {
  test('moves an existing plan.md into _archive and removes the original', async () => {
    const dir = await tempWorkflowDir();
    await writeFile(join(dir, 'plan.md'), '# bad plan\n[System: thinking_tokens]', 'utf-8');

    const archived = await archiveWorkflowFile(dir, 'plan');

    expect(archived).toBe(true);
    expect(existsSync(join(dir, 'plan.md'))).toBe(false); // original gone → planner must regenerate
    const archiveRoot = join(dir, '_archive');
    const stamps = await readdir(archiveRoot);
    expect(stamps.length).toBe(1);
    const moved = await readFile(join(archiveRoot, stamps[0]!, 'plan.md'), 'utf-8');
    expect(moved).toContain('bad plan');
  });

  test('returns false when the file does not exist (no-op)', async () => {
    const dir = await tempWorkflowDir();
    expect(await archiveWorkflowFile(dir, 'plan')).toBe(false);
  });
});

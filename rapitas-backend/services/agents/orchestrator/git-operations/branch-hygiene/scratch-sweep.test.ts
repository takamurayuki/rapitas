/**
 * scratch-sweep.test
 *
 * Workflow scratch files (`.wf-*`, `*.wf-*`, `.wftmp*`, `.tmp_wf*`) that agents
 * write next to the repo and do not always delete are removed once they are
 * old — but only when git ignores them, so a tracked or deliberately added
 * file of the same shape is never touched.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepScratchFiles } from './scratch-sweep';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const DAY = 24 * 60 * 60 * 1000;

let repo: string;

/** Write a file and date it `ageMs` in the past. */
function fileAged(rel: string, ageMs: number): string {
  const p = join(repo, rel);
  writeFileSync(p, 'x');
  const t = new Date(Date.now() - ageMs);
  utimesSync(p, t, t);
  return p;
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-sweep-')));
  git(repo, 'init', '-q', '-b', 'develop');
  mkdirSync(join(repo, 'rapitas-backend'));
  writeFileSync(join(repo, '.gitignore'), '.wf-*\n*.wf-*\n/.wftmp*\n.tmp_wf*\n');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('sweepScratchFiles', () => {
  test('removes old ignored scratch files at the root and in package roots', async () => {
    const old = [
      fileAged('.wf-1103-plan.json', 2 * DAY),
      fileAged('Projectsrapitas.worktreestask-825-ca42fafc.wf-check.json', 2 * DAY),
      fileAged('.wftmp.json', 2 * DAY),
      fileAged('rapitas-backend/.wf-a.json', 2 * DAY),
      fileAged('rapitas-backend/.tmp_wf1.json', 2 * DAY),
    ];

    const result = await sweepScratchFiles(repo, {
      now: Date.now(),
      packageDirs: ['rapitas-backend'],
    });

    expect(result.removed).toHaveLength(old.length);
    for (const p of old) expect(existsSync(p)).toBe(false);
  });

  test('keeps a scratch file that is still recent (an agent may be using it)', async () => {
    const fresh = fileAged('.wf-live.json', 10 * 60 * 1000);
    await sweepScratchFiles(repo, { now: Date.now(), packageDirs: [] });
    expect(existsSync(fresh)).toBe(true);
  });

  test('never touches a file git does not ignore, even with a scratch-like name', async () => {
    writeFileSync(join(repo, '.gitignore'), '.wf-*\n!.wf-keep.md\n');
    const kept = fileAged('.wf-keep.md', 3 * DAY);
    await sweepScratchFiles(repo, { now: Date.now(), packageDirs: [] });
    expect(existsSync(kept)).toBe(true);
  });

  test('leaves other old files alone', async () => {
    const other = fileAged('notes.md', 30 * DAY);
    await sweepScratchFiles(repo, { now: Date.now(), packageDirs: [] });
    expect(existsSync(other)).toBe(true);
  });
});

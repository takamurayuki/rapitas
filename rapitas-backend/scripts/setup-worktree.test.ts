/**
 * setup-worktree.test.ts
 *
 * Regression coverage for task 607: `tests/services/test-triage.test.ts` (and
 * every other backend test importing config/database.ts) failed inside a git
 * worktree with "Cannot find module '../generated/prisma-postgres'" because
 * setup-worktree.cjs never linked the gitignored top-level
 * rapitas-backend/generated/{prisma-postgres,prisma-sqlite} output of
 * prisma/schema/_generators.prisma from the main checkout. Spawns the real
 * script against a real (temporary) main repo + linked worktree pair — the
 * same mechanism the bug manifested through — instead of mocking fs.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// setup-worktree.cjs is a repo-root script (shared across all sub-projects),
// not part of rapitas-backend — it lives two levels up from this test file.
const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'setup-worktree.cjs');
const GENERATED_RELS = [
  'rapitas-backend/generated/prisma-postgres',
  'rapitas-backend/generated/prisma-sqlite',
];

let base: string | null = null;

afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true });
  base = null;
});

function initMainRepoWithWorktree(): { mainRepo: string; worktree: string } {
  base = mkdtempSync(join(tmpdir(), 'setup-worktree-test-'));
  const mainRepo = join(base, 'main');
  mkdirSync(mainRepo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: mainRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: mainRepo });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: mainRepo });
  writeFileSync(join(mainRepo, 'README.md'), 'placeholder');
  execFileSync('git', ['add', '-A'], { cwd: mainRepo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: mainRepo });

  const worktree = join(base, 'wt');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'test-branch', worktree], {
    cwd: mainRepo,
  });
  return { mainRepo, worktree };
}

describe('setup-worktree.cjs generated Prisma artifact linking', () => {
  test('links rapitas-backend/generated/prisma-postgres and prisma-sqlite into a linked worktree', () => {
    const { mainRepo, worktree } = initMainRepoWithWorktree();
    for (const rel of GENERATED_RELS) {
      mkdirSync(join(mainRepo, rel), { recursive: true });
    }

    execFileSync(process.execPath, [SCRIPT, worktree], { encoding: 'utf8' });

    for (const rel of GENERATED_RELS) {
      const linkPath = join(worktree, rel);
      expect(existsSync(linkPath)).toBe(true);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    }
  });

  test('skips linking (does not crash) when the main repo has no generated Prisma output yet', () => {
    const { worktree } = initMainRepoWithWorktree();

    expect(() => {
      execFileSync(process.execPath, [SCRIPT, worktree], { encoding: 'utf8' });
    }).not.toThrow();

    for (const rel of GENERATED_RELS) {
      expect(existsSync(join(worktree, rel))).toBe(false);
    }
  });
});

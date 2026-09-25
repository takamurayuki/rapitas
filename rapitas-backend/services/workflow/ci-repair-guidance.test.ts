/**
 * ci-repair-guidance test
 *
 * Confirms the ci_repair feedback source wires in the worktree-only guidance.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CI_REPAIR_WORKTREE_GUIDANCE } from './ci-repair-guidance';

describe('CI_REPAIR_WORKTREE_GUIDANCE', () => {
  test('names the forbidden actions', () => {
    for (const word of ['worktree', 'primary', 'git pull', 'prisma', 'db:prepare', 'taskkill']) {
      expect(CI_REPAIR_WORKTREE_GUIDANCE).toContain(word);
    }
  });

  test('is included in the feedback written by ci-self-repair', () => {
    const source = readFileSync(join(import.meta.dir, 'ci-self-repair.ts'), 'utf8');
    expect(source).toContain('${CI_REPAIR_WORKTREE_GUIDANCE}');
  });
});

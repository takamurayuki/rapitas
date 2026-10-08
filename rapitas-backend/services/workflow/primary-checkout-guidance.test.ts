/**
 * primary-checkout-guidance test
 *
 * Confirms the shared guidance names the forbidden `git -C <primary>` form and the cwd alternative.
 */
import { describe, test, expect } from 'bun:test';
import { PRIMARY_CHECKOUT_GUIDANCE } from './primary-checkout-guidance';
import { buildRoleTexts } from './workflow-role-prompts';

describe('PRIMARY_CHECKOUT_GUIDANCE', () => {
  test.each(['ja', 'en'] as const)('%s names the forbidden form and the alternative', (lang) => {
    const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
    expect(text).toContain('git -C');
    expect(text).toContain('git branch --show-current');
    expect(text).toContain('origin/');
    expect(text).not.toContain('C:/Projects');
  });

  test.each(['ja', 'en'] as const)(
    '%s points sibling-worktree reads to git show/grep on origin',
    (lang) => {
      const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
      expect(text).toContain('.worktrees');
      expect(text).toContain('git show origin/<branch>:<path>');
      expect(text).toContain('git grep <pattern> origin/<branch>');
      expect(text).toContain('git fetch origin <branch>');
    },
  );
});

describe('PRIMARY_CHECKOUT_GUIDANCE wiring (task 1132)', () => {
  test.each(['ja', 'en'] as const)('%s tells agents their cwd is already the worktree', (lang) => {
    const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
    expect(text).toContain('cwd');
    expect(text).toMatch(/相対パス|relative to your cwd/);
  });

  test.each(['ja', 'en'] as const)('%s reaches every role prompt', (lang) => {
    const t = buildRoleTexts(1, { title: 't', description: null }, lang);
    const g = PRIMARY_CHECKOUT_GUIDANCE[lang].trimEnd();
    expect(t.researcher.items).toContain(g);
    expect(t.planner.instruction).toContain(g);
    expect(t.implementer.constraints).toContain(g);
    expect(t.verifier.instruction).toContain(g);
  });
});

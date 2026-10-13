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

describe('PRIMARY_CHECKOUT_GUIDANCE process lifecycle (task 1171)', () => {
  test.each([
    ['ja', '自力で終了させず', '最終報告'],
    ['en', 'terminate', 'final report'],
  ] as const)('%s tells agents to record started processes instead of killing', (lang, a, b) => {
    const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
    expect(text).toContain(a);
    expect(text).toContain(b);
    expect(text).toContain('PID');
    expect(text).not.toContain('verify.md');
  });

  test.each(['ja', 'en'] as const)('%s reaches the implementer constraints', (lang) => {
    const t = buildRoleTexts(1, { title: 't', description: null }, lang);
    expect(t.implementer.constraints).toContain('PID');
    expect(t.implementer.constraints).toContain(lang === 'ja' ? '自力で終了させず' : 'terminate');
  });
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

describe('PRIMARY_CHECKOUT_GUIDANCE fallback-chain ban (task 1200)', () => {
  test.each([
    ['ja', '失敗時に worktree へ', '2>/dev/null'],
    ['en', 'falls back to your worktree', '2>/dev/null'],
  ] as const)('%s forbids the try-primary-then-worktree chain', (lang, a, b) => {
    const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
    expect(text).toContain(a);
    expect(text).toContain(b);
    expect(text).toContain('<worktree>');
    expect(text).not.toContain('C:/Projects');
  });
});

describe('PRIMARY_CHECKOUT_GUIDANCE tool location (task 1229)', () => {
  test.each(['ja', 'en'] as const)(
    '%s says formatter binaries already exist in the worktree and how to run them',
    (lang) => {
      const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
      expect(text).toContain('prettier');
      expect(text).toContain('node_modules/.bin');
      expect(text).toContain('pnpm exec prettier --write <');
      expect(text).toContain('npx --no-install prettier --write <');
      expect(text).toContain('node node_modules/prettier/bin/prettier.cjs --write');
      expect(text).toContain('setup-worktree');
      expect(text).not.toContain('C:/Projects');
      expect(text).not.toContain('/c/Projects');
    },
  );

  test.each(['ja', 'en'] as const)('%s forbids install in the worktree', (lang) => {
    expect(PRIMARY_CHECKOUT_GUIDANCE[lang]).toMatch(/install/);
  });
});

describe('PRIMARY_CHECKOUT_GUIDANCE primary-subdirectory chain (task 1227)', () => {
  test.each(['ja', 'en'] as const)(
    '%s names the <primary>/rapitas-backend form and a relative alternative',
    (lang) => {
      const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
      expect(text).toContain('cd <primary>/rapitas-backend 2>/dev/null; cd <worktree>');
      expect(text).toContain('cd rapitas-backend');
      expect(text).toContain('npx --no-install prettier --write rapitas-backend/<path>');
      expect(text).not.toContain('C:/Projects');
      expect(text).not.toContain('/c/Projects');
    },
  );
});

/**
 * glob-match tests
 */
import { describe, expect, test } from 'bun:test';
import { normalizePath, matchesPattern, matchesAnyPattern } from './glob-match';

describe('normalizePath', () => {
  test('converts backslashes, lowercases and strips ./', () => {
    expect(normalizePath('.\\Rapitas-Backend\\X.ts')).toBe('rapitas-backend/x.ts');
  });

  test('strips the working directory prefix', () => {
    expect(
      normalizePath(
        'C:\\Projects\\rapitas\\.worktrees\\task-1218\\rapitas-backend\\x.ts',
        'C:\\Projects\\rapitas\\.worktrees\\task-1218',
      ),
    ).toBe('rapitas-backend/x.ts');
  });
});

describe('matchesPattern', () => {
  const cases: Array<[string, string, boolean]> = [
    ['rapitas-backend/services/a.ts', 'rapitas-backend/**', true],
    ['rapitas-backend/services/a.ts', 'rapitas-backend/**/*.ts', true],
    ['rapitas-backend/a.ts', 'rapitas-backend/**/*.ts', true],
    ['rapitas-backend/services/a.tsx', 'rapitas-backend/**/*.ts', false],
    ['rapitas-backend/a.ts', 'rapitas-backend/*.ts', true],
    ['rapitas-backend/x/a.ts', 'rapitas-backend/*.ts', false],
    ['src/a1.ts', 'src/a?.ts', true],
    ['src/feature/x.tsx', 'src/feature/', true],
    ['src/feature/x.tsx', 'src/feature', true],
    ['src/featurex/x.tsx', 'src/feature', false],
    ['src/a.ts', 'src/a.ts', true],
    ['src/b.ts', 'src/a.ts', false],
    ['Src/A.TS', 'src/a.ts', true],
  ];
  for (const [path, pattern, expected] of cases) {
    test(`${path} vs ${pattern} → ${expected}`, () => {
      expect(matchesPattern(path, pattern)).toBe(expected);
    });
  }

  test('Windows absolute worktree path matches a relative declaration with workDir', () => {
    expect(
      matchesPattern(
        'C:\\Projects\\rapitas\\.worktrees\\task-1218\\rapitas-backend\\x.ts',
        'rapitas-backend/**',
        'C:\\Projects\\rapitas\\.worktrees\\task-1218',
      ),
    ).toBe(true);
  });

  test('absolute path without workDir still matches by segment suffix', () => {
    expect(
      matchesPattern(
        'C:\\Projects\\rapitas\\.worktrees\\t\\rapitas-backend\\x.ts',
        'rapitas-backend/**',
      ),
    ).toBe(true);
    expect(matchesPattern('/home/u/repo/other/x.ts', 'rapitas-backend/**')).toBe(false);
  });

  test('matchesAnyPattern', () => {
    expect(matchesAnyPattern('a/b.ts', ['x/**', 'a/**'])).toBe(true);
    expect(matchesAnyPattern('a/b.ts', [])).toBe(false);
  });
});

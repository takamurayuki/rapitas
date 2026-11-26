/**
 * auto-run-concurrency.per-theme.test
 *
 * Table tests for the per-theme concurrency limit (task 1552): settings value,
 * clamping, the AUTO_RUN_THEME_MAX_CONCURRENCY override and the cap by the
 * global limit.
 */
import { describe, it, expect, mock } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';
import {
  parseEnvAutoRunMaxConcurrencyPerTheme,
  resolveAutoRunMaxConcurrencyPerTheme,
} from './auto-run-concurrency';

function prismaWith(settings: unknown, throws = false): PrismaClient {
  return {
    userSettings: {
      findFirst: mock(async () => {
        if (throws) throw new Error('db down');
        return settings;
      }),
    },
  } as unknown as PrismaClient;
}

describe('resolveAutoRunMaxConcurrencyPerTheme', () => {
  const cases: Array<{
    name: string;
    settings: unknown;
    env: Record<string, string>;
    expected: { limit: number; source: 'env' | 'settings'; effective: number };
  }> = [
    {
      name: 'unset column (client before regeneration) → 1',
      settings: { autoRunMaxConcurrency: 2 },
      env: {},
      expected: { limit: 1, source: 'settings', effective: 1 },
    },
    {
      name: 'settings 2, global 2 → effective 2',
      settings: { autoRunMaxConcurrency: 2, autoRunMaxConcurrencyPerTheme: 2 },
      env: {},
      expected: { limit: 2, source: 'settings', effective: 2 },
    },
    {
      name: 'per-theme larger than the global cap → capped by global',
      settings: { autoRunMaxConcurrency: 2, autoRunMaxConcurrencyPerTheme: 4 },
      env: {},
      expected: { limit: 4, source: 'settings', effective: 2 },
    },
    {
      name: 'out of range 9 → clamped to 4',
      settings: { autoRunMaxConcurrency: 4, autoRunMaxConcurrencyPerTheme: 9 },
      env: {},
      expected: { limit: 4, source: 'settings', effective: 4 },
    },
    {
      name: 'out of range 0 → clamped to 1',
      settings: { autoRunMaxConcurrency: 4, autoRunMaxConcurrencyPerTheme: 0 },
      env: {},
      expected: { limit: 1, source: 'settings', effective: 1 },
    },
    {
      name: 'env override wins over settings',
      settings: { autoRunMaxConcurrency: 4, autoRunMaxConcurrencyPerTheme: 1 },
      env: { AUTO_RUN_THEME_MAX_CONCURRENCY: '3' },
      expected: { limit: 3, source: 'env', effective: 3 },
    },
    {
      name: 'invalid env falls back to settings',
      settings: { autoRunMaxConcurrency: 4, autoRunMaxConcurrencyPerTheme: 2 },
      env: { AUTO_RUN_THEME_MAX_CONCURRENCY: 'abc' },
      expected: { limit: 2, source: 'settings', effective: 2 },
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      expect(await resolveAutoRunMaxConcurrencyPerTheme(prismaWith(c.settings), c.env)).toEqual(
        c.expected,
      );
    });
  }

  it('settings read failure → 1 (the pre-task behaviour)', async () => {
    expect(await resolveAutoRunMaxConcurrencyPerTheme(prismaWith(null, true), {})).toEqual({
      limit: 1,
      source: 'settings',
      effective: 1,
    });
  });

  it('parses only positive integers from the env var', () => {
    expect(parseEnvAutoRunMaxConcurrencyPerTheme({})).toBeNull();
    expect(
      parseEnvAutoRunMaxConcurrencyPerTheme({ AUTO_RUN_THEME_MAX_CONCURRENCY: '0' }),
    ).toBeNull();
    expect(parseEnvAutoRunMaxConcurrencyPerTheme({ AUTO_RUN_THEME_MAX_CONCURRENCY: '2' })).toBe(2);
  });
});

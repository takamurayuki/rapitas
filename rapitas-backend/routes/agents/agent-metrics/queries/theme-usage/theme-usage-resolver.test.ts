/**
 * theme-usage-resolver unit tests
 *
 * Verifies the session → config → task → theme chain, the read-only keyword
 * re-classification (first enabled rule by sortOrder wins), the 未分類 bucket
 * for broken chains, and that `in` lookups are chunked.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const sessionFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const configFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const taskFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
mock.module('../../../../../config/database', () => ({
  prisma: {
    agentSession: { findMany: sessionFind },
    developerModeConfig: { findMany: configFind },
    task: { findMany: taskFind },
  },
}));

import { classifyByRules, resolveSessionThemes, RESOLVE_CHUNK_SIZE } from './theme-usage-resolver';
import type { ClassificationRule } from '../../../../../services/usage-budget/usage-budget-types';

const rule = (themeId: number, keyword: string, sortOrder: number, enabled = true) =>
  ({ themeId, keyword, sortOrder, enabled }) satisfies ClassificationRule;

beforeEach(() => {
  sessionFind.mockReset();
  configFind.mockReset();
  taskFind.mockReset();
  sessionFind.mockImplementation(() => Promise.resolve([]));
  configFind.mockImplementation(() => Promise.resolve([]));
  taskFind.mockImplementation(() => Promise.resolve([]));
});

describe('classifyByRules', () => {
  test('matches case-insensitively as a substring', () => {
    expect(classifyByRules('Fix LOGIN bug', [rule(5, 'login', 0)])).toBe(5);
  });
  test('the lowest sortOrder wins when several rules match', () => {
    const rules = [rule(2, 'bug', 2), rule(3, 'fix', 1)];
    expect(classifyByRules('fix bug', rules)).toBe(3);
  });
  test('disabled and blank rules are ignored', () => {
    expect(classifyByRules('fix bug', [rule(2, 'bug', 0, false), rule(4, '  ', 1)])).toBeNull();
  });
  test('returns null when nothing matches or the title is missing', () => {
    expect(classifyByRules('docs', [rule(2, 'bug', 0)])).toBeNull();
    expect(classifyByRules(null, [rule(2, 'bug', 0)])).toBeNull();
  });
});

describe('resolveSessionThemes', () => {
  test('resolves the full chain to Task.themeId', async () => {
    sessionFind.mockImplementation(() => Promise.resolve([{ id: 10, configId: 100 }]));
    configFind.mockImplementation(() => Promise.resolve([{ id: 100, taskId: 1000 }]));
    taskFind.mockImplementation(() =>
      Promise.resolve([{ id: 1000, themeId: 7, title: 'anything' }]),
    );
    const map = await resolveSessionThemes([10], []);
    expect(map.get(10)).toEqual({ themeId: 7, resolved: true });
  });

  test('re-classifies a theme-less task by rule, without touching the task', async () => {
    sessionFind.mockImplementation(() => Promise.resolve([{ id: 10, configId: 100 }]));
    configFind.mockImplementation(() => Promise.resolve([{ id: 100, taskId: 1000 }]));
    taskFind.mockImplementation(() =>
      Promise.resolve([{ id: 1000, themeId: null, title: 'Refactor billing' }]),
    );
    const map = await resolveSessionThemes([10], [rule(9, 'billing', 0)]);
    expect(map.get(10)).toEqual({ themeId: 9, resolved: true });
  });

  test('a theme-less task without a matching rule lands in 未分類 (0)', async () => {
    sessionFind.mockImplementation(() => Promise.resolve([{ id: 10, configId: 100 }]));
    configFind.mockImplementation(() => Promise.resolve([{ id: 100, taskId: 1000 }]));
    taskFind.mockImplementation(() => Promise.resolve([{ id: 1000, themeId: null, title: 'x' }]));
    const map = await resolveSessionThemes([10], []);
    expect(map.get(10)).toEqual({ themeId: 0, resolved: true });
  });

  test('a broken chain is 未分類 and flagged unresolved', async () => {
    sessionFind.mockImplementation(() =>
      Promise.resolve([
        { id: 10, configId: 100 },
        { id: 11, configId: 101 },
      ]),
    );
    configFind.mockImplementation(() => Promise.resolve([{ id: 100, taskId: 1000 }]));
    taskFind.mockImplementation(() => Promise.resolve([]));
    const map = await resolveSessionThemes([10, 11, 12], []);
    expect(map.get(10)).toEqual({ themeId: 0, resolved: false }); // task missing
    expect(map.get(11)).toEqual({ themeId: 0, resolved: false }); // config missing
    expect(map.get(12)).toEqual({ themeId: 0, resolved: false }); // session missing
  });

  test('multiple sessions of one task share the theme; lookups are chunked', async () => {
    const ids = Array.from({ length: RESOLVE_CHUNK_SIZE + 1 }, (_, i) => i + 1);
    sessionFind.mockImplementation((args: unknown) => {
      const inIds = (args as { where: { id: { in: number[] } } }).where.id.in;
      return Promise.resolve(inIds.map((id) => ({ id, configId: 100 })));
    });
    configFind.mockImplementation(() => Promise.resolve([{ id: 100, taskId: 1000 }]));
    taskFind.mockImplementation(() => Promise.resolve([{ id: 1000, themeId: 3, title: 't' }]));
    const map = await resolveSessionThemes(ids, []);
    expect(sessionFind).toHaveBeenCalledTimes(2);
    expect(map.size).toBe(ids.length);
    expect(map.get(ids[ids.length - 1])).toEqual({ themeId: 3, resolved: true });
  });

  test('no sessions means no queries', async () => {
    const map = await resolveSessionThemes([], []);
    expect(map.size).toBe(0);
    expect(sessionFind).not.toHaveBeenCalled();
  });
});

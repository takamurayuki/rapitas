/**
 * knowledge-usefulness.test
 *
 * Covers reading each entry's recall record. The rule that matters most: an
 * entry with no record is absent from the map, never present with a zero — a
 * new entry is not a useless one.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const findMany = mock((): Promise<{ metadata: string | null }[]> => Promise.resolve([]));

mock.module('../../config/database', () => ({
  prisma: { activityLog: { findMany } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { knowledgeUsefulness } = await import('./knowledge-usefulness');
const row = (entryId: number, used: boolean) => ({ metadata: JSON.stringify({ entryId, used }) });

describe('knowledgeUsefulness', () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  test('counts injections and declared uses per entry', async () => {
    findMany.mockResolvedValue([row(7, true), row(7, false), row(7, true), row(8, false)]);

    const out = await knowledgeUsefulness([7, 8]);

    expect(out.get(7)).toEqual({ injected: 3, used: 2, rate: 2 / 3 });
    expect(out.get(8)).toEqual({ injected: 1, used: 0, rate: 0 });
  });

  test('an entry with no record is absent, not zero', async () => {
    findMany.mockResolvedValue([row(7, true)]);

    const out = await knowledgeUsefulness([7, 99]);

    expect(out.has(99)).toBe(false);
  });

  test('ignores records for entries nobody asked about', async () => {
    findMany.mockResolvedValue([row(1, true), row(2, true)]);
    expect([...(await knowledgeUsefulness([1])).keys()]).toEqual([1]);
  });

  test('a corrupt record is skipped rather than breaking the lookup', async () => {
    findMany.mockResolvedValue([{ metadata: '{not json' }, row(7, true)]);
    expect((await knowledgeUsefulness([7]))?.get(7)?.injected).toBe(1);
  });

  test('a failed lookup yields no data rather than throwing into recall', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    expect((await knowledgeUsefulness([7])).size).toBe(0);
  });

  test('an empty request does not query at all', async () => {
    expect((await knowledgeUsefulness([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

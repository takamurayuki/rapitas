/**
 * concern-promotion-guard.test
 *
 * 2026-11-20: the nightly scan had filed the same two trendline security
 * findings almost daily since 10/10, each time in new words. The validator
 * rejected most of them, yet the critical-concern bypass promoted five
 * rejected ones in a row (tasks 1513-1517), each running research through
 * verify before blocking.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

let row: { validationStatus: string | null } | null = null;
const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
mock.module('../../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findUnique: async () => row,
      update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push(args);
        return {};
      },
    },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { retireIfRejected } = await import('./concern-promotion-guard');

beforeEach(() => {
  row = null;
  updates.length = 0;
});

describe('retireIfRejected', () => {
  test('retires a concern the validator rejected, so the next pick is another one', async () => {
    row = { validationStatus: 'rejected' };
    expect(await retireIfRejected(14660)).toBe(true);
    expect(updates[0]).toMatchObject({ where: { id: 14660 }, data: { sourceId: 'dismissed' } });
  });

  test.each(['validated', 'pending', null])('promotes a %s concern as before', async (status) => {
    row = { validationStatus: status };
    expect(await retireIfRejected(1)).toBe(false);
    expect(updates).toEqual([]);
  });

  test('promotes as before when the status cannot be read (fails open)', async () => {
    row = null;
    expect(await retireIfRejected(1)).toBe(false);
  });
});

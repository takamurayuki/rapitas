/**
 * label-category-backfill.test (#1000)
 *
 * The theme→category label backfill moved out of the labels route module's
 * import-time IIFE. It must still copy the theme's category onto theme-scoped
 * labels, skip labels whose theme has none, and never throw on a boot.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let orphans: Array<{ id: number; theme: { categoryId: number | null } | null }> = [];
let failRead = false;
const updates: Array<{ id: number; categoryId: number }> = [];

mock.module('../../config/database', () => ({
  prisma: {
    label: {
      findMany: async () => {
        if (failRead) throw new Error('disk I/O error');
        return orphans;
      },
      update: async (args: { where: { id: number }; data: { categoryId: number } }) => {
        updates.push({ id: args.where.id, categoryId: args.data.categoryId });
        return {};
      },
    },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { backfillLabelCategories } = await import('./label-category-backfill');

beforeEach(() => {
  orphans = [];
  failRead = false;
  updates.length = 0;
});

describe('backfillLabelCategories', () => {
  it("copies the theme's category onto each theme-scoped label", async () => {
    orphans = [
      { id: 1, theme: { categoryId: 7 } },
      { id: 2, theme: { categoryId: null } },
      { id: 3, theme: null },
    ];
    expect(await backfillLabelCategories()).toBe(1);
    expect(updates).toEqual([{ id: 1, categoryId: 7 }]);
  });

  it('returns 0 instead of throwing when the database fails', async () => {
    failRead = true;
    expect(await backfillLabelCategories()).toBe(0);
  });
});

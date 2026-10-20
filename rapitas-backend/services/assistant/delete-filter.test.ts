/**
 * delete-filter.test
 *
 * This is the most destructive thing ラピ can set up — hundreds of tasks at
 * once — so the tests are about what the conditions actually resolve to, not
 * about the shape of the response. An over-broad `where` here is a mass
 * deletion the user approved without knowing.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** The `where` each query was given, in call order. */
let wheres: Record<string, unknown>[] = [];
/** Rows findMany should return. */
let rows: { id: number; title: string; status: string; updatedAt: Date }[] = [];
/** What count should report. */
let counts: number[] = [];
let countIndex = 0;

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push({ op: 'count', ...where });
        return counts[countIndex++] ?? 0;
      },
      findMany: async ({ where, take, orderBy }: Record<string, unknown>) => {
        wheres.push({ op: 'findMany', take, orderBy, ...(where as object) });
        return rows;
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

const { previewDeleteFilter, MAX_PREVIEW_ROWS } = await import('./delete-filter');

/** The `where` the listing query used. */
const listWhere = () => wheres.find((w) => w.op === 'findMany')!;

beforeEach(() => {
  wheres = [];
  rows = [{ id: 1, title: 'a', status: 'done', updatedAt: new Date() }];
  counts = [1, 0];
  countIndex = 0;
});

describe('what the conditions resolve to', () => {
  test('scopes to the theme when one is given', async () => {
    await previewDeleteFilter({ themeId: 1 });
    expect(listWhere().themeId).toBe(1);
  });

  // Without this the preview would quietly span every theme.
  test('leaves the theme out only when none was asked for', async () => {
    await previewDeleteFilter({});
    expect('themeId' in listWhere()).toBe(false);
  });

  test('matches only the statuses asked for', async () => {
    await previewDeleteFilter({ statuses: ['done', 'cancelled'] });
    expect(listWhere().status).toEqual({ in: ['done', 'cancelled'] });
  });

  // A status nobody recognises must not widen the match by being ignored
  // into "no status condition at all".
  test('drops a status it does not recognise', async () => {
    await previewDeleteFilter({ statuses: ['done', 'ちょっと違うやつ'] });
    expect(listWhere().status).toEqual({ in: ['done'] });
  });

  test('applies no status condition when none survive', async () => {
    await previewDeleteFilter({ statuses: ['でたらめ'] });
    expect('status' in listWhere()).toBe(false);
  });

  test('turns an age in days into a cutoff', async () => {
    await previewDeleteFilter({ updatedBeforeDays: 90 });
    const cutoff = (listWhere().updatedAt as { lt: Date }).lt;
    const days = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(90);
  });

  test('ignores a nonsensical age rather than matching everything', async () => {
    await previewDeleteFilter({ updatedBeforeDays: -5 });
    expect('updatedAt' in listWhere()).toBe(false);
  });

  // The delete path refuses these, so a preview that lists them is promising
  // something it cannot deliver.
  test('never lists a protected task', async () => {
    await previewDeleteFilter({ themeId: 1 });
    expect(listWhere().isProtected).toBe(false);
  });
});

describe('what it reports', () => {
  test('counts every match, not just the rows it returns', async () => {
    counts = [412, 0];
    rows = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      title: 't' + i,
      status: 'done',
      updatedAt: new Date(),
    }));
    const out = await previewDeleteFilter({ themeId: 1 });
    expect(out.total).toBe(412);
    expect(out.matches).toHaveLength(50);
    expect(out.truncated).toBe(true);
  });

  test('is not truncated when everything fits', async () => {
    counts = [1, 0];
    const out = await previewDeleteFilter({ themeId: 1 });
    expect(out.truncated).toBe(false);
  });

  test('caps how many rows travel with the count', async () => {
    await previewDeleteFilter({ themeId: 1 });
    expect(listWhere().take).toBe(MAX_PREVIEW_ROWS);
  });

  // Oldest first: when the list is capped, the rows shown are the ones most
  // likely to be wanted gone.
  test('lists the longest-untouched first', async () => {
    await previewDeleteFilter({ themeId: 1 });
    expect(listWhere().orderBy).toEqual({ updatedAt: 'asc' });
  });

  test('says how many protected tasks it left out', async () => {
    counts = [10, 3];
    const out = await previewDeleteFilter({ themeId: 1 });
    expect(out.excludedProtected).toBe(3);
  });
});

/**
 * concern-search-service.test.ts
 *
 * Verifies searchConcerns pulls every page (no silent truncation at the first
 * page) and filters by parsed type/severity/keywords. listConcerns is stubbed
 * via mock.module (process-global — run this file in isolation).
 */
import { describe, it, expect, mock } from 'bun:test';

type Row = {
  id: number;
  title: string;
  detail: string;
  location: string | null;
  type: string;
  severity: string;
  originTaskId: number | null;
  createdTaskId: number | null;
};

const rows: Row[] = Array.from({ length: 150 }, (_, i) => ({
  id: i + 1,
  title: i === 140 ? 'Slow needleword query' : `perf concern ${i + 1}`,
  detail: 'detail',
  location: null,
  type: 'perf',
  severity: i % 2 === 0 ? 'urgent' : 'low',
  originTaskId: i === 0 ? 7 : null,
  createdTaskId: null,
}));

const mockListConcerns = mock(async (opts: { limit?: number; offset?: number }) => ({
  concerns: rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 20)),
  total: rows.length,
})) as ReturnType<typeof mock>;

mock.module('./concern-backlog-service', () => ({ listConcerns: mockListConcerns }));

const { searchConcerns } = await import('./concern-search-service');

describe('searchConcerns', () => {
  it('finds a match that lives beyond the first page of the store', async () => {
    const res = await searchConcerns({ q: 'needleword' });
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe(141);
    expect(res.parsed.keywords).toEqual(['needleword']);
  });

  it('applies parsed severity filters and returns the 6-key JSON', async () => {
    const res = await searchConcerns({ q: 'Show me PERF-related blocking concerns', limit: 5 });
    expect(res.total).toBe(75);
    expect(res.items).toHaveLength(5);
    expect(Object.keys(res.items[0]).sort()).toEqual(
      ['id', 'impactScore', 'pattern', 'priority', 'relatedTasks', 'title'].sort(),
    );
    expect(res.items[0]).toMatchObject({ priority: 'Critical', relatedTasks: 1, impactScore: 8.8 });
  });

  it('returns everything of type perf for an empty query and honours offset', async () => {
    const res = await searchConcerns({ q: '', limit: 10, offset: 145 });
    expect(res.total).toBe(150);
    expect(res.items).toHaveLength(5);
  });
});

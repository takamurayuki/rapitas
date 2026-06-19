/**
 * knowledge-graph.test
 *
 * Verifies that listNodes builds mode-safe WHERE clauses for search:
 * - SQLite: no `mode` key in label/description filters
 * - PostgreSQL: `mode: 'insensitive'` present
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const mockFindMany = mock(() => Promise.resolve([]));
const mockCount = mock(() => Promise.resolve(0));

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeGraphNode: { findMany: mockFindMany, count: mockCount },
  },
}));

const { listNodes } = await import('./knowledge-graph');

type StringFilter = { contains: string; mode?: string };

describe('listNodes — mode guard', () => {
  let savedProvider: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    mockFindMany.mockReset();
    mockCount.mockReset();
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
  });

  it('postgresql: OR filters contain mode:insensitive', async () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    await listNodes({ search: 'typescript' });
    const where = mockFindMany.mock.calls[0][0].where as {
      OR: Array<{ label: StringFilter } | { description: StringFilter }>;
    };
    expect(where.OR).toHaveLength(2);
    expect((where.OR[0] as { label: StringFilter }).label.mode).toBe('insensitive');
    expect((where.OR[1] as { description: StringFilter }).description.mode).toBe('insensitive');
  });

  it('sqlite: OR filters have no mode key', async () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    await listNodes({ search: 'typescript' });
    const where = mockFindMany.mock.calls[0][0].where as {
      OR: Array<{ label: StringFilter } | { description: StringFilter }>;
    };
    expect(where.OR).toHaveLength(2);
    expect((where.OR[0] as { label: StringFilter }).label).not.toHaveProperty('mode');
    expect((where.OR[1] as { description: StringFilter }).description).not.toHaveProperty('mode');
  });

  it('search unset: OR is not added to where', async () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    await listNodes({});
    const where = mockFindMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).not.toHaveProperty('OR');
  });
});

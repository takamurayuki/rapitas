/**
 * episode-memory.test
 *
 * Verifies that findSimilarEpisodes builds mode-safe WHERE clauses:
 * - SQLite: no `mode` key in content filter
 * - PostgreSQL: `mode: 'insensitive'` present
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const mockFindMany = mock(() => Promise.resolve([]));

mock.module('../../config/database', () => ({
  prisma: {
    episodeMemory: { findMany: mockFindMany },
  },
}));

const { findSimilarEpisodes } = await import('./episode-memory');

describe('findSimilarEpisodes — mode guard', () => {
  let savedProvider: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
  });

  it('postgresql: content filter contains mode:insensitive', async () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    await findSimilarEpisodes('memory test');
    const where = mockFindMany.mock.calls[0][0].where as Record<
      string,
      { contains: string; mode?: string }
    >;
    expect(where.content.mode).toBe('insensitive');
    expect(where.content.contains).toBe('memory test');
  });

  it('sqlite: content filter has no mode key', async () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    await findSimilarEpisodes('memory test');
    const where = mockFindMany.mock.calls[0][0].where as Record<
      string,
      { contains: string; mode?: string }
    >;
    expect(where.content).not.toHaveProperty('mode');
    expect(where.content.contains).toBe('memory test');
  });
});

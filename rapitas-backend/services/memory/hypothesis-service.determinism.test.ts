/**
 * hypothesis-service.determinism.test
 *
 * Locks the hypothesis-ledger listing guarantee: the paginated list query
 * carries a terminal `{ id: 'asc' }` tie-break, so equal confidence/updatedAt
 * ties cannot reshuffle a page (and thus the prompt-visible ledger) across
 * otherwise-identical requests.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFindMany = mock(() => Promise.resolve([]));
const mockCount = mock(() => Promise.resolve(0));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { knowledgeEntry: { findMany: mockFindMany, count: mockCount } },
}));

const { listHypotheses } = await import('./hypothesis-service');

describe('listHypotheses — deterministic ordering', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
    mockCount.mockReset();
    mockCount.mockResolvedValue(0);
  });

  it('orders by confidence, updatedAt, then id as the terminal tie-break', async () => {
    await listHypotheses({});

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const orderBy = mockFindMany.mock.calls[0][0].orderBy as Array<Record<string, string>>;
    expect(Array.isArray(orderBy)).toBe(true);
    // The final key must be the id tie-break so pagination is reproducible.
    expect(orderBy[orderBy.length - 1]).toEqual({ id: 'asc' });
  });
});

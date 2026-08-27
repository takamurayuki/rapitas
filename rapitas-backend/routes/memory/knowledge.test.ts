/**
 * knowledge.test.ts
 *
 * Unit tests for /knowledge/:id routes via Elysia handle(). Covers the
 * PrismaClientValidationError regression (#686): a non-numeric `:id`
 * (e.g. `abc`) must be rejected with 400 before reaching Prisma, instead of
 * calling `prisma.knowledgeEntry.findUnique({ where: { id: NaN } })`.
 * services/memory and config/database are stubbed via mock.module
 * (process-global — run this file in isolation).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockUpdateKnowledgeEntry = mock(() => Promise.resolve({ id: 1 })) as ReturnType<typeof mock>;
const mockArchiveKnowledgeEntry = mock(() => Promise.resolve({ id: 1 })) as ReturnType<typeof mock>;
const mockPinKnowledgeEntry = mock(() => Promise.resolve({ id: 1 })) as ReturnType<typeof mock>;
const mockCreateKnowledgeEntry = mock(() => Promise.resolve({ id: 1 })) as ReturnType<typeof mock>;
const mockListKnowledgeEntries = mock(() =>
  Promise.resolve({ entries: [], total: 0 }),
) as ReturnType<typeof mock>;
const mockGetKnowledgeStats = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;

mock.module('../../services/memory', () => ({
  createKnowledgeEntry: mockCreateKnowledgeEntry,
  updateKnowledgeEntry: mockUpdateKnowledgeEntry,
  archiveKnowledgeEntry: mockArchiveKnowledgeEntry,
  pinKnowledgeEntry: mockPinKnowledgeEntry,
  listKnowledgeEntries: mockListKnowledgeEntries,
  getKnowledgeStats: mockGetKnowledgeStats,
}));

const mockSearchKnowledgeHybrid = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
mock.module('../../services/memory/recall/hybrid-search', () => ({
  searchKnowledgeHybrid: mockSearchKnowledgeHybrid,
}));

const mockResetEmbeddingPipeline = mock(() => undefined) as ReturnType<typeof mock>;
mock.module('../../services/memory/rag/embedding', () => ({
  resetEmbeddingPipeline: mockResetEmbeddingPipeline,
}));

const mockBoostDecayOnAccess = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
mock.module('../../services/memory/forgetting', () => ({
  boostDecayOnAccess: mockBoostDecayOnAccess,
}));

const mockFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findUnique: mockFindUnique,
    },
  },
}));

const { knowledgeRoutes } = await import('./knowledge');

const BASE = 'http://localhost/knowledge';

function resetMocks() {
  mockUpdateKnowledgeEntry.mockReset();
  mockArchiveKnowledgeEntry.mockReset();
  mockPinKnowledgeEntry.mockReset();
  mockCreateKnowledgeEntry.mockReset();
  mockListKnowledgeEntries.mockReset();
  mockGetKnowledgeStats.mockReset();
  mockSearchKnowledgeHybrid.mockReset();
  mockResetEmbeddingPipeline.mockReset();
  mockBoostDecayOnAccess.mockReset();
  mockFindUnique.mockReset();

  mockUpdateKnowledgeEntry.mockResolvedValue({ id: 1 });
  mockArchiveKnowledgeEntry.mockResolvedValue({ id: 1 });
  mockPinKnowledgeEntry.mockResolvedValue({ id: 1 });
  mockCreateKnowledgeEntry.mockResolvedValue({ id: 1 });
  mockListKnowledgeEntries.mockResolvedValue({ entries: [], total: 0 });
  mockGetKnowledgeStats.mockResolvedValue({});
  mockSearchKnowledgeHybrid.mockResolvedValue([]);
  mockBoostDecayOnAccess.mockResolvedValue(undefined);
  mockFindUnique.mockResolvedValue(null);
}

describe('GET /knowledge/:id', () => {
  beforeEach(resetMocks);

  it('不正な id (数値でない) は 400 を返し findUnique を呼ばないこと', async () => {
    const res = await knowledgeRoutes.handle(new Request(`${BASE}/abc`));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid ID');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockBoostDecayOnAccess).not.toHaveBeenCalled();
  });

  it('数値の id は findUnique に渡され、見つからなければ 404 を返すこと', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await knowledgeRoutes.handle(new Request(`${BASE}/42`));

    expect(res.status).toBe(404);
    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }));
  });
});

describe('PUT /knowledge/:id', () => {
  beforeEach(resetMocks);

  it('不正な id は 400 を返し updateKnowledgeEntry を呼ばないこと', async () => {
    const res = await knowledgeRoutes.handle(
      new Request(`${BASE}/abc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid ID');
    expect(mockUpdateKnowledgeEntry).not.toHaveBeenCalled();
  });
});

describe('DELETE /knowledge/:id', () => {
  beforeEach(resetMocks);

  it('不正な id は 400 を返し archiveKnowledgeEntry を呼ばないこと', async () => {
    const res = await knowledgeRoutes.handle(new Request(`${BASE}/abc`, { method: 'DELETE' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid ID');
    expect(mockArchiveKnowledgeEntry).not.toHaveBeenCalled();
  });
});

describe('POST /knowledge/:id/pin', () => {
  beforeEach(resetMocks);

  it('不正な id は 400 を返し pinKnowledgeEntry を呼ばないこと', async () => {
    const res = await knowledgeRoutes.handle(
      new Request(`${BASE}/abc/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: '2026-01-01T00:00:00.000Z' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid ID');
    expect(mockPinKnowledgeEntry).not.toHaveBeenCalled();
  });
});

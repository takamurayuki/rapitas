/**
 * themes.runtime-config.test
 *
 * Unit tests for the runtimeConfigJson validation this route added: a
 * broken value must be rejected at save time (400), not silently persisted
 * to fail later at preview/verify time. Only exercises the create/update
 * handlers' validation path — the rest of themes.ts (git/filesystem
 * operations in setup-from-claude-md, branch listing) is out of scope here.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { errorHandler } from '../../middleware/error-handler';

const mockThemeCreate = mock(() => Promise.resolve({ id: 1 }));
const mockThemeUpdate = mock(() => Promise.resolve({ id: 1 }));
const mockThemeFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>({ id: 1 }));
const mockCategoryFindFirst = mock(() => Promise.resolve<Record<string, unknown> | null>(null));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    theme: {
      create: mockThemeCreate,
      update: mockThemeUpdate,
      findUnique: mockThemeFindUnique,
    },
    category: { findFirst: mockCategoryFindFirst },
  },
}));

const { themesRoutes } = await import('./themes');
const app = new Elysia().use(errorHandler).use(themesRoutes);

const VALID_CONFIG = JSON.stringify({
  start: 'npm run dev -- -p {port}',
  url: 'http://localhost:{port}',
});

function resetMocks() {
  mockThemeCreate.mockReset().mockResolvedValue({ id: 1 });
  mockThemeUpdate.mockReset().mockResolvedValue({ id: 1 });
  mockThemeFindUnique.mockReset().mockResolvedValue({ id: 1 });
  mockCategoryFindFirst.mockReset().mockResolvedValue(null);
}

describe('POST /themes — runtimeConfigJson validation', () => {
  beforeEach(resetMocks);

  it('accepts a valid runtimeConfigJson and persists it', async () => {
    const res = await app.handle(
      new Request('http://localhost/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', categoryId: 1, runtimeConfigJson: VALID_CONFIG }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockThemeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ runtimeConfigJson: VALID_CONFIG }),
      }),
    );
  });

  it('rejects invalid JSON with 400 and does not call theme.create', async () => {
    const res = await app.handle(
      new Request('http://localhost/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', categoryId: 1, runtimeConfigJson: 'not json' }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockThemeCreate).not.toHaveBeenCalled();
  });

  it('rejects a JSON object missing required fields with 400', async () => {
    const res = await app.handle(
      new Request('http://localhost/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          categoryId: 1,
          runtimeConfigJson: JSON.stringify({ foo: 'bar' }),
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockThemeCreate).not.toHaveBeenCalled();
  });

  it('omitting runtimeConfigJson entirely is fine (feature stays opted-out)', async () => {
    const res = await app.handle(
      new Request('http://localhost/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', categoryId: 1 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockThemeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ runtimeConfigJson: expect.anything() }),
      }),
    );
  });
});

describe('PATCH /themes/:id — runtimeConfigJson validation', () => {
  beforeEach(resetMocks);

  it('accepts a valid runtimeConfigJson update', async () => {
    const res = await app.handle(
      new Request('http://localhost/themes/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeConfigJson: VALID_CONFIG }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockThemeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ runtimeConfigJson: VALID_CONFIG }),
      }),
    );
  });

  it('rejects an invalid runtimeConfigJson update with 400', async () => {
    const res = await app.handle(
      new Request('http://localhost/themes/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeConfigJson: '{ broken' }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockThemeUpdate).not.toHaveBeenCalled();
  });

  it('allows clearing runtimeConfigJson by sending null', async () => {
    const res = await app.handle(
      new Request('http://localhost/themes/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeConfigJson: null }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockThemeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ runtimeConfigJson: null }) }),
    );
  });
});

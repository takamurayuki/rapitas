/**
 * theme-auto-run-service.test.ts
 *
 * Unit tests for ThemeAutoRun state transitions.
 * Mocks the prisma import so no live DB is needed.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock functions — defined before mock.module() so the factory can close over them
// ---------------------------------------------------------------------------
const mockUpsert = mock(() => Promise.resolve({}));
const mockUpdate = mock(() => Promise.resolve({}));
const mockUpdateMany = mock(() => Promise.resolve({ count: 0 }));
const mockFindUnique = mock(() => Promise.resolve(null));
const mockCreate = mock(() => Promise.resolve({}));

mock.module('../../../config', () => ({
  prisma: {
    themeAutoRun: {
      findUnique: mockFindUnique,
      create: mockCreate,
      upsert: mockUpsert,
      update: mockUpdate,
      updateMany: mockUpdateMany,
    },
  },
}));

// Re-import AFTER mock is installed
const {
  startAutoRun,
  pauseAutoRun,
  stopAutoRun,
  resumeAutoRun,
  isThemeAutoRunActive,
  finalizeStop,
} = await import('./theme-auto-run-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    themeId: 42,
    enabled: false,
    status: 'idle',
    order: 'priority',
    currentTaskId: null,
    processedCount: 0,
    lastError: null,
    lastRunAt: null,
    startedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function resetMocks() {
  mockUpsert.mockClear();
  mockUpdate.mockClear();
  mockUpdateMany.mockClear();
  mockFindUnique.mockClear();
  mockCreate.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isThemeAutoRunActive', () => {
  beforeEach(resetMocks);

  it.each([
    {
      desc: 'returns false for null themeId',
      themeId: null as number | null,
      mockValue: undefined as Record<string, unknown> | null | undefined,
      expected: false,
    },
    {
      desc: 'returns true when status is running',
      themeId: 42,
      mockValue: { status: 'running' },
      expected: true,
    },
    {
      desc: 'returns true when status is paused',
      themeId: 42,
      mockValue: { status: 'paused' },
      expected: true,
    },
    {
      desc: 'returns false when status is idle',
      themeId: 42,
      mockValue: { status: 'idle' },
      expected: false,
    },
    {
      desc: 'returns false when record does not exist',
      themeId: 42,
      mockValue: null,
      expected: false,
    },
  ])('$desc', async ({ themeId, mockValue, expected }) => {
    if (mockValue !== undefined) mockFindUnique.mockResolvedValue(mockValue);
    expect(await isThemeAutoRunActive(themeId)).toBe(expected);
  });
});

describe('startAutoRun', () => {
  beforeEach(resetMocks);

  it('upserts with status running', async () => {
    const record = makeRecord({ status: 'running' });
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue(record);

    const result = await startAutoRun(42);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { themeId: 42 },
        create: expect.objectContaining({ status: 'running' }),
        update: expect.objectContaining({ status: 'running' }),
      }),
    );
    expect(result.status).toBe('running');
  });

  it('returns existing record unchanged when already running', async () => {
    const record = makeRecord({ status: 'running' });
    mockFindUnique.mockResolvedValue(record);

    const result = await startAutoRun(42);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(result.status).toBe('running');
  });

  it('clears idleSince/idleStoppedAt (task 784: a start ends any idle-stop timer)', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue(makeRecord({ status: 'running' }));

    const result = await startAutoRun(42);

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 42 },
      data: { idleSince: null, idleStoppedAt: null },
    });
    expect(result.idleSince).toBeNull();
    expect(result.idleStoppedAt).toBeNull();
  });
});

describe('pauseAutoRun', () => {
  beforeEach(resetMocks);

  it('sets status to paused', async () => {
    mockUpsert.mockResolvedValue(makeRecord({ status: 'paused' }));
    const result = await pauseAutoRun(42);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'paused' }),
      }),
    );
    expect(result.status).toBe('paused');
  });
});

describe('stopAutoRun', () => {
  beforeEach(resetMocks);

  it('sets status to stopping', async () => {
    mockUpsert.mockResolvedValue(makeRecord({ status: 'stopping' }));
    const result = await stopAutoRun(42);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'stopping' }),
      }),
    );
    expect(result.status).toBe('stopping');
  });
});

describe('resumeAutoRun', () => {
  beforeEach(resetMocks);

  it('transitions paused → running', async () => {
    mockFindUnique.mockResolvedValue(makeRecord({ status: 'paused' }));
    mockUpdate.mockResolvedValue(makeRecord({ status: 'running' }));

    const result = await resumeAutoRun(42);
    expect(result?.status).toBe('running');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'running' } }),
    );
  });

  it('no-ops when not paused', async () => {
    mockFindUnique.mockResolvedValue(makeRecord({ status: 'running' }));

    const result = await resumeAutoRun(42);
    expect(result?.status).toBe('running');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns null when record not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await resumeAutoRun(42);
    expect(result).toBeNull();
  });
});

describe('finalizeStop', () => {
  beforeEach(resetMocks);

  it('sets idle + disabled + clears currentTaskId', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await finalizeStop(42);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 42 },
      data: { status: 'idle', enabled: false, currentTaskId: null },
    });
  });

  it('also clears idleSince/idleStoppedAt (task 784: a USER stop is never auto re-armed)', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await finalizeStop(42);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 42 },
      data: { idleSince: null, idleStoppedAt: null },
    });
  });
});

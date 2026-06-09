/**
 * theme-auto-run-service.test.ts
 *
 * Unit tests for ThemeAutoRun state transitions.
 * Mocks the prisma import so no live DB is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock prisma before importing the module under test
// ---------------------------------------------------------------------------
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock('../../../config', () => ({
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
import {
  startAutoRun,
  pauseAutoRun,
  stopAutoRun,
  resumeAutoRun,
  isThemeAutoRunActive,
  finalizeStop,
} from './theme-auto-run-service';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isThemeAutoRunActive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false for null themeId', async () => {
    expect(await isThemeAutoRunActive(null)).toBe(false);
  });

  it('returns true when status is running', async () => {
    mockFindUnique.mockResolvedValue({ status: 'running' });
    expect(await isThemeAutoRunActive(42)).toBe(true);
  });

  it('returns true when status is paused', async () => {
    mockFindUnique.mockResolvedValue({ status: 'paused' });
    expect(await isThemeAutoRunActive(42)).toBe(true);
  });

  it('returns false when status is idle', async () => {
    mockFindUnique.mockResolvedValue({ status: 'idle' });
    expect(await isThemeAutoRunActive(42)).toBe(false);
  });

  it('returns false when record does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await isThemeAutoRunActive(42)).toBe(false);
  });
});

describe('startAutoRun', () => {
  beforeEach(() => vi.clearAllMocks());

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
});

describe('pauseAutoRun', () => {
  beforeEach(() => vi.clearAllMocks());

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
  beforeEach(() => vi.clearAllMocks());

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
  beforeEach(() => vi.clearAllMocks());

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
  beforeEach(() => vi.clearAllMocks());

  it('sets idle + disabled + clears currentTaskId', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await finalizeStop(42);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 42 },
      data: { status: 'idle', enabled: false, currentTaskId: null },
    });
  });
});

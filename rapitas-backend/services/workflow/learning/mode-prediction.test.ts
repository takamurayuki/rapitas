/**
 * mode-prediction.test
 *
 * Covers the prediction half of the workflow ledger: what research predicted is
 * written once, at the moment it was predicted, and read back verbatim when the
 * outcome lands. Reconstructing it later is what left predictedComplexity 13%
 * filled and the 35/70/85 thresholds unverifiable (measured 2026-08-25).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const create = mock(() => Promise.resolve({ id: 1 }));
const findFirst = mock((): Promise<{ metadata: string | null } | null> => Promise.resolve(null));

mock.module('../../../config/database', () => ({
  prisma: { activityLog: { create, findFirst } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { recordModePrediction, readModePrediction, MODE_PREDICTION_ACTION } =
  await import('./mode-prediction');

const SAMPLE = {
  predictedComplexity: 42,
  workflowMode: 'standard' as const,
  estimatedDurationMinutes: 90,
  thresholds: { min: 36, max: 70 },
  wasOverridden: false,
};

describe('recordModePrediction', () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: 1 });
    findFirst.mockReset().mockResolvedValue(null);
  });

  test('persists the whole prediction, including the band that produced the mode', async () => {
    await recordModePrediction(658, SAMPLE);

    const arg = create.mock.calls[0]?.[0] as {
      data: { taskId: number; action: string; metadata: string };
    };
    expect(arg.data.taskId).toBe(658);
    expect(arg.data.action).toBe(MODE_PREDICTION_ACTION);
    // The threshold band must survive: without it the mode cannot be checked
    // against the score that selected it.
    expect(JSON.parse(arg.data.metadata)).toEqual(SAMPLE);
  });

  test('never throws — bookkeeping must not fail the research phase', async () => {
    create.mockRejectedValueOnce(new Error('db down'));
    expect(await recordModePrediction(658, SAMPLE)).toBeUndefined();
  });
});

describe('readModePrediction', () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: 1 });
    findFirst.mockReset().mockResolvedValue(null);
  });

  test('returns the latest snapshot when research re-ran', async () => {
    findFirst.mockResolvedValue({ metadata: JSON.stringify(SAMPLE) });

    expect(await readModePrediction(658)).toEqual(SAMPLE);
    const arg = findFirst.mock.calls[0]?.[0] as { orderBy: { id: string } };
    expect(arg.orderBy.id).toBe('desc');
  });

  test('returns null when nothing was predicted', async () => {
    expect(await readModePrediction(658)).toBeNull();
  });

  test('rejects a snapshot missing the score rather than inventing one', async () => {
    findFirst.mockResolvedValue({ metadata: JSON.stringify({ workflowMode: 'standard' }) });
    expect(await readModePrediction(658)).toBeNull();
  });

  test('survives corrupt metadata', async () => {
    findFirst.mockResolvedValue({ metadata: '{not json' });
    expect(await readModePrediction(658)).toBeNull();
  });

  test('keeps a null estimate null instead of coercing it to zero', async () => {
    findFirst.mockResolvedValue({
      metadata: JSON.stringify({ ...SAMPLE, estimatedDurationMinutes: null }),
    });
    expect((await readModePrediction(658))?.estimatedDurationMinutes).toBeNull();
  });
});

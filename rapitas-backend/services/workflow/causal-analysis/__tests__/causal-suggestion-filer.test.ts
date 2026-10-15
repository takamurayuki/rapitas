/**
 * causal-suggestion-filer tests
 *
 * Covers filing from a cascade, stable dedup key on recurrence, and non-fatal failure.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const T0 = Date.parse('2026-10-06T00:00:00.000Z');

const mockFindMany = mock(() => Promise.resolve([] as unknown[]));
const mockSubmitConcern = mock((_input: unknown) => Promise.resolve(undefined));

mock.module('../../../../config/database', () => ({
  prisma: { workflowQueueItem: { findMany: mockFindMany } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../../memory/concern-backlog-service', () => ({
  submitConcern: mockSubmitConcern,
}));

const { fileCausalSuggestions } = await import('../causal-suggestion-filer');

const row = (taskId: number, status: string, deps: number[], completedMs: number | null) => ({
  taskId,
  status,
  dependencies: JSON.stringify(deps),
  queuedAt: new Date(T0),
  startedAt: new Date(T0),
  completedAt: completedMs === null ? null : new Date(T0 + completedMs),
  errorMessage: status === 'failed' ? 'boom' : null,
});

const cascade = () => [
  row(1, 'running', [], null),
  row(2, 'failed', [1], 15 * 60_000),
  row(3, 'failed', [1], 20 * 60_000),
  row(4, 'queued', [1], null),
];

describe('fileCausalSuggestions', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockSubmitConcern.mockReset();
    mockSubmitConcern.mockResolvedValue(undefined);
  });

  it('files one evidence-backed suggestion keyed only by the root taskId', async () => {
    mockFindMany.mockResolvedValue(cascade());
    const n = await fileCausalSuggestions(7, [], T0 + 40 * 60_000);
    expect(n).toBe(1);
    const input = mockSubmitConcern.mock.calls[0][0] as {
      dedupKey: string;
      detail: string;
      themeId: number;
    };
    expect(input.dedupKey).toBe('causal-root:1');
    expect(input.themeId).toBe(7);
    expect(input.detail).toContain('根拠');
    expect(input.detail).toContain('4'); // at-risk queued task listed
  });

  it('uses the same dedup key when the cascade recurs at a later time', async () => {
    mockFindMany.mockResolvedValue(cascade());
    await fileCausalSuggestions(7, [], T0 + 40 * 60_000);
    await fileCausalSuggestions(7, [], T0 + 50 * 60_000);
    const keys = mockSubmitConcern.mock.calls.map((c) => (c[0] as { dedupKey: string }).dedupKey);
    expect(keys).toEqual(['causal-root:1', 'causal-root:1']);
  });

  it('files nothing when there is no cascade', async () => {
    mockFindMany.mockResolvedValue([row(1, 'completed', [], 1000)]);
    expect(await fileCausalSuggestions(7, [], T0 + 60_000)).toBe(0);
    expect(mockSubmitConcern).not.toHaveBeenCalled();
  });

  it('swallows DB errors and returns 0', async () => {
    mockFindMany.mockRejectedValue(new Error('db down'));
    expect(await fileCausalSuggestions(7, [], T0)).toBe(0);
  });

  it('cites time-correlated queue-stall WARN log entries as evidence', async () => {
    mockFindMany.mockResolvedValue(cascade());
    const logs = [
      { msg: 'Slow queue processing', time: T0 + 12 * 60_000 },
      { msg: 'Execution result ignored after cancellation', time: T0 + 20 * 60_000 },
      { msg: 'Slow queue processing', time: T0 + 31 * 60_000 }, // outside the window
      { msg: 'unrelated warning', time: T0 + 12 * 60_000 },
    ];
    await fileCausalSuggestions(7, logs, T0 + 40 * 60_000);
    const input = mockSubmitConcern.mock.calls[0][0] as { detail: string };
    expect(input.detail).toContain('キュー停滞WARNログ: 2 件');
  });
});

/**
 * auto-run-release-awaiting-ci.test
 *
 * Task 1568: a task that only waits for CI / its required merge hands its slot back (without
 * counting a finished task) and the theme selects the next task; a task that does NOT wait for CI
 * (merged, repairing, running) is left alone, and a lost race or failed write keeps the slot.
 * The transaction itself is covered against a real SQLite DB in
 * awaiting-ci-release-txn.interleave.test.ts.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../observability', () => ({ logCycleEvent: mock(() => {}) }));

let awaitingCi = true;
mock.module('../awaiting-ci-lookup', () => ({
  isTaskAwaitingCi: mock(async () => awaitingCi),
  isQueueItemHandedBack: mock(async () => false),
  listAwaitingCi: mock(async () => []),
}));
let behind = false;
const liveMock = mock(async (_p: unknown, _t: number, _o?: unknown) => behind);
mock.module('./queue-wait-exemption', () => ({ liveOrQueuedBehind: liveMock }));
let outcome = 'head_removed';
const releaseThemeSlotMock = mock(async () => outcome);
mock.module('./parallel/theme-active-set', () => ({
  releaseThemeSlot: releaseThemeSlotMock,
  retrackThemeSlot: mock(async () => {}),
}));
mock.module('./auto-run-lifecycle', () => ({ broadcastAutoRunUpdateImpl: mock(() => {}) }));
const selectNextMock = mock(async () => {});
mock.module('./auto-run-advance-select', () => ({ selectAndEnqueueNextTask: selectNextMock }));
type TxnResult =
  | { result: 'released'; count: number }
  | { result: 'lost' }
  | { result: 'failed'; error: unknown };
let txnResult: TxnResult = { result: 'released', count: 1 };
const txnMock = mock(async (_p: unknown, _t: number, _ids: number[]) => txnResult);
mock.module('./awaiting-ci-release-txn', () => ({ handBackAwaitingCiItems: txnMock }));

const { releaseAwaitingCiSlot } = await import('./auto-run-release-awaiting-ci');

let activeItems: { id: number }[] = [{ id: 11 }];
const findManyMock = mock(async (_a: unknown) => activeItems);
let ownerItem: { id: number } | null = null;
const findFirstMock = mock(async (_a: unknown) => ownerItem);
const prisma = {
  workflowQueueItem: { findMany: findManyMock, findFirst: findFirstMock },
} as unknown as PrismaClient;
const run = () => releaseAwaitingCiSlot(prisma, 1, 100, 'priority', 1, new Map());

beforeEach(() => {
  awaitingCi = true;
  behind = false;
  outcome = 'head_removed';
  txnResult = { result: 'released', count: 1 };
  activeItems = [{ id: 11 }];
  ownerItem = null;
  releaseThemeSlotMock.mockClear();
  selectNextMock.mockClear();
  txnMock.mockClear();
  liveMock.mockClear();
  findManyMock.mockClear();
  findManyMock.mockImplementation(async () => activeItems);
});

describe('releaseAwaitingCiSlot', () => {
  test('A waits for CI: items handed back in one transaction, slot released uncounted, next selected', async () => {
    expect(await run()).toBe(true);
    expect(txnMock.mock.calls[0].slice(1)).toEqual([100, [11]]);
    expect(releaseThemeSlotMock.mock.calls[0]).toEqual([prisma, 1, 100, 'released']);
    expect(selectNextMock).toHaveBeenCalledTimes(1);
  });

  test('the queue-wait check is quiet and fails closed (no WARN every tick)', async () => {
    await run();
    expect(liveMock.mock.calls[0][2]).toEqual({ quiet: true, failClosed: true });
  });

  test('no active item (already handed back / never had one): only the slot is freed', async () => {
    activeItems = [];
    expect(await run()).toBe(true);
    expect(txnMock).not.toHaveBeenCalled();
    expect(releaseThemeSlotMock).toHaveBeenCalledTimes(1);
    expect(selectNextMock).toHaveBeenCalledTimes(1);
  });

  test('second tick (slot already gone): nothing is selected twice', async () => {
    activeItems = [];
    outcome = 'not_member';
    expect(await run()).toBe(true);
    expect(selectNextMock).not.toHaveBeenCalled();
  });

  test('CI green and merged, or CI red and repairing: not a CI wait → untouched', async () => {
    awaitingCi = false;
    expect(await run()).toBe(false);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(txnMock).not.toHaveBeenCalled();
    expect(releaseThemeSlotMock).not.toHaveBeenCalled();
  });

  test('a live execution (e.g. a repair already running) keeps the slot', async () => {
    behind = true;
    expect(await run()).toBe(true);
    expect(txnMock).not.toHaveBeenCalled();
    expect(releaseThemeSlotMock).not.toHaveBeenCalled();
    expect(selectNextMock).not.toHaveBeenCalled();
  });

  test('lost race (a repair changed the task first): slot kept, nothing selected, no requeue', async () => {
    txnResult = { result: 'lost' };
    expect(await run()).toBe(true);
    expect(releaseThemeSlotMock).not.toHaveBeenCalled();
    expect(selectNextMock).not.toHaveBeenCalled();
  });

  test('a failed transaction keeps the slot instead of releasing it', async () => {
    txnResult = { result: 'failed', error: new Error('SQLITE_BUSY') };
    expect(await run()).toBe(true);
    expect(releaseThemeSlotMock).not.toHaveBeenCalled();
    expect(selectNextMock).not.toHaveBeenCalled();
  });

  test('an unreadable item list keeps the slot', async () => {
    findManyMock.mockRejectedValueOnce(new Error('db'));
    expect(await run()).toBe(true);
    expect(txnMock).not.toHaveBeenCalled();
    expect(releaseThemeSlotMock).not.toHaveBeenCalled();
  });

  test('a runner that claimed its item (or a queued repair) owns the task: slot kept, nothing written', async () => {
    ownerItem = { id: 12 };
    expect(await run()).toBe(true);
    expect(txnMock).not.toHaveBeenCalled();
    expect(releaseThemeSlotMock).not.toHaveBeenCalled();
    expect(selectNextMock).not.toHaveBeenCalled();
    expect(findFirstMock.mock.calls[0][0]).toMatchObject({
      where: { taskId: 100, currentPhase: { not: 'ci_wait' } },
    });
  });
});

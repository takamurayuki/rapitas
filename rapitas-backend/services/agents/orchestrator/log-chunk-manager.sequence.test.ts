/**
 * log-chunk-manager — lastQueuedSequence lets a tool call point at the log
 * chunk that announced it (task 1218 deviation context lookup).
 */
import { describe, expect, mock, test } from 'bun:test';
import { createLogChunkManager } from './log-chunk-manager';
import type { LogManagerContext } from './execution-helpers-types';

function makeCtx(initialSequenceNumber: number): LogManagerContext {
  return {
    prisma: {
      agentExecutionLog: { createMany: mock(async () => ({ count: 1 })) },
    } as unknown as LogManagerContext['prisma'],
    executionId: 1,
    initialSequenceNumber,
  };
}

describe('lastQueuedSequence', () => {
  test('tracks the sequence number the latest chunk receives, before and after flush', async () => {
    const manager = createLogChunkManager(makeCtx(10));
    expect(manager.lastQueuedSequence()).toBe(9);
    manager.addChunk('a', false);
    manager.addChunk('b', false);
    expect(manager.lastQueuedSequence()).toBe(11);
    await manager.flushLogChunks();
    expect(manager.lastQueuedSequence()).toBe(11);
    manager.addChunk('c', false);
    expect(manager.lastQueuedSequence()).toBe(12);
    await manager.cleanup();
  });
});

/**
 * Log Chunk Manager
 *
 * Batched log persistence for agent execution output.
 */
import type { LogManagerContext } from './execution-helpers-types';
import { createLogger } from '../../../config/logger';

const logger = createLogger('log-chunk-manager');

const LOG_BATCH_INTERVAL = 500;

/**
 * Create a log chunk manager for batched log persistence.
 */
export function createLogChunkManager(ctx: LogManagerContext) {
  let logSequenceNumber = ctx.initialSequenceNumber;
  let pendingLogChunks: { chunk: string; isError: boolean; timestamp: Date }[] = [];
  let pendingLogSave = false;
  const cleanupHandlers: Array<() => Promise<void>> = [];
  const registerCleanup = (handler: () => Promise<void>) => cleanupHandlers.push(handler);

  const flushLogChunks = async () => {
    if (pendingLogSave || pendingLogChunks.length === 0) return;
    pendingLogSave = true;
    const chunksToSave = [...pendingLogChunks];
    pendingLogChunks = [];

    try {
      const logEntries = chunksToSave.map((chunk) => ({
        executionId: ctx.executionId,
        logChunk: chunk.chunk,
        logType: chunk.isError ? 'stderr' : 'stdout',
        sequenceNumber: logSequenceNumber++,
        timestamp: chunk.timestamp,
      }));

      await ctx.prisma.agentExecutionLog.createMany({
        data: logEntries,
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to save log chunks');
      pendingLogChunks = [...chunksToSave, ...pendingLogChunks];
    } finally {
      pendingLogSave = false;
    }
  };

  const logFlushInterval = setInterval(flushLogChunks, LOG_BATCH_INTERVAL);

  const addChunk = (chunk: string, isError: boolean) => {
    pendingLogChunks.push({ chunk, isError, timestamp: new Date() });
  };

  // Sequence number the most recently queued chunk has or will receive.
  // Pending chunks are numbered in order at flush time, so the next one is
  // logSequenceNumber + pending.length - 1.
  const lastQueuedSequence = () => logSequenceNumber + pendingLogChunks.length - 1;

  const cleanup = async () => {
    clearInterval(logFlushInterval);
    await Promise.all(cleanupHandlers.map((handler) => handler()));
    await flushLogChunks();
  };

  return { addChunk, cleanup, flushLogChunks, registerCleanup, lastQueuedSequence };
}

export type LogChunkManager = ReturnType<typeof createLogChunkManager>;

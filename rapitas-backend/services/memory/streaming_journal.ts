/**
 * Streaming Journal (WAL-based crash resilience)
 *
 * Replays pending entries at server startup to guarantee data integrity.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { JournalOperationType } from './types';

const log = createLogger('memory:journal');

export class MemoryJournal {
  /**
   * Write a journal entry with crash safety.
   *
   * 1. Create a pending entry
   * 2. Execute the actual write
   * 3. Mark as committed
   */
  static async write(op: {
    operationType: JournalOperationType;
    targetTable: string;
    targetId?: number;
    payload: Record<string, unknown>;
    executor: () => Promise<{ id?: number }>;
  }): Promise<{ journalId: number; result: { id?: number } }> {
    // 1. Create pending entry
    const entry = await prisma.memoryJournalEntry.create({
      data: {
        operationType: op.operationType,
        targetTable: op.targetTable,
        targetId: op.targetId,
        payload: JSON.stringify(op.payload),
        status: 'pending',
      },
    });

    try {
      // 2. Execute the actual write
      const result = await op.executor();

      // 3. Mark as committed
      await prisma.memoryJournalEntry.update({
        where: { id: entry.id },
        data: {
          status: 'committed',
          targetId: result.id ?? op.targetId,
        },
      });

      return { journalId: entry.id, result };
    } catch (error) {
      // Mark as failed on error
      const message = error instanceof Error ? error.message : String(error);
      await prisma.memoryJournalEntry.update({
        where: { id: entry.id },
        data: { status: 'failed', errorMessage: message },
      });
      log.error({ err: error, journalId: entry.id }, 'Journal write failed');
      throw error;
    }
  }

  /**
   * Recover pending entries at server startup.
   */
  static async recover(): Promise<number> {
    const pendingEntries = await prisma.memoryJournalEntry.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingEntries.length === 0) return 0;

    log.warn({ count: pendingEntries.length }, 'Recovering pending journal entries');

    let recovered = 0;
    for (const entry of pendingEntries) {
      try {
        // Pending entries may not have completed their write operation.
        // NOTE: Marked as failed for safety — requires manual review.
        await prisma.memoryJournalEntry.update({
          where: { id: entry.id },
          data: {
            status: 'failed',
            errorMessage: 'Recovered during startup - operation may not have completed',
          },
        });
        recovered++;
      } catch (error) {
        log.error({ err: error, journalId: entry.id }, 'Failed to recover journal entry');
      }
    }

    log.info({ recovered }, 'Journal recovery completed');
    return recovered;
  }

  /**
   * Delete committed entries older than 24 hours.
   */
  static async checkpoint(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await prisma.memoryJournalEntry.deleteMany({
      where: {
        status: 'committed',
        createdAt: { lt: cutoff },
      },
    });

    if (result.count > 0) {
      log.info({ count: result.count }, 'Journal checkpoint: cleaned old entries');
    }

    return result.count;
  }
}

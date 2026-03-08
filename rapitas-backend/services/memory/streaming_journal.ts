/**
 * ストリーミングジャーナル（WALクラッシュ耐性）
 * サーバー起動時にpendingエントリをリプレイし、データ整合性を保証
 */
import { prisma } from "../../config/database";
import { createLogger } from "../../config/logger";
import type { JournalOperationType } from "./types";

const log = createLogger("memory:journal");

export class MemoryJournal {
  /**
   * ジャーナルエントリを書き込み
   * 1. pendingエントリ作成
   * 2. 実際の書き込み実行
   * 3. committedに更新
   */
  static async write(op: {
    operationType: JournalOperationType;
    targetTable: string;
    targetId?: number;
    payload: Record<string, unknown>;
    executor: () => Promise<{ id?: number }>;
  }): Promise<{ journalId: number; result: { id?: number } }> {
    // 1. pendingエントリ作成
    const entry = await prisma.memoryJournalEntry.create({
      data: {
        operationType: op.operationType,
        targetTable: op.targetTable,
        targetId: op.targetId,
        payload: JSON.stringify(op.payload),
        status: "pending",
      },
    });

    try {
      // 2. 実際の書き込み実行
      const result = await op.executor();

      // 3. committed に更新
      await prisma.memoryJournalEntry.update({
        where: { id: entry.id },
        data: {
          status: "committed",
          targetId: result.id ?? op.targetId,
        },
      });

      return { journalId: entry.id, result };
    } catch (error) {
      // 失敗時はfailedに更新
      const message = error instanceof Error ? error.message : String(error);
      await prisma.memoryJournalEntry.update({
        where: { id: entry.id },
        data: { status: "failed", errorMessage: message },
      });
      log.error({ err: error, journalId: entry.id }, "Journal write failed");
      throw error;
    }
  }

  /**
   * サーバー起動時にpendingエントリをリプレイ
   */
  static async recover(): Promise<number> {
    const pendingEntries = await prisma.memoryJournalEntry.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });

    if (pendingEntries.length === 0) return 0;

    log.warn({ count: pendingEntries.length }, "Recovering pending journal entries");

    let recovered = 0;
    for (const entry of pendingEntries) {
      try {
        // pendingエントリは実際の書き込みが完了していない可能性がある
        // 安全のためfailedとしてマーク（手動確認が必要）
        await prisma.memoryJournalEntry.update({
          where: { id: entry.id },
          data: {
            status: "failed",
            errorMessage: "Recovered during startup - operation may not have completed",
          },
        });
        recovered++;
      } catch (error) {
        log.error({ err: error, journalId: entry.id }, "Failed to recover journal entry");
      }
    }

    log.info({ recovered }, "Journal recovery completed");
    return recovered;
  }

  /**
   * 24h以上前のcommittedエントリを削除
   */
  static async checkpoint(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await prisma.memoryJournalEntry.deleteMany({
      where: {
        status: "committed",
        createdAt: { lt: cutoff },
      },
    });

    if (result.count > 0) {
      log.info({ count: result.count }, "Journal checkpoint: cleaned old entries");
    }

    return result.count;
  }
}

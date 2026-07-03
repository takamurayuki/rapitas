/**
 * log-chunk-manager ユニットテスト
 *
 * バッチ書き込み（addChunk → flush）、失敗時のチャンク再キュー、
 * cleanup による最終フラッシュを検証する。
 * setInterval は各テスト終了時に必ず cleanup() で解除し、プロセスに
 * タイマーを残さない。
 */
import { describe, expect, test, mock } from 'bun:test';
import { createLogChunkManager } from './log-chunk-manager';
import type { LogManagerContext } from './execution-helpers-types';

type LogEntry = {
  executionId: number;
  logChunk: string;
  logType: string;
  sequenceNumber: number;
  timestamp: Date;
};

/** テスト用の LogManagerContext を、createMany の挙動を差し替え可能な形で構築する */
function makeCtx(
  createManyImpl: (args: { data: LogEntry[] }) => Promise<unknown>,
  initialSequenceNumber = 0,
): LogManagerContext {
  return {
    prisma: {
      agentExecutionLog: { createMany: mock(createManyImpl) },
    } as unknown as LogManagerContext['prisma'],
    executionId: 42,
    initialSequenceNumber,
  };
}

describe('createLogChunkManager', () => {
  test('保留チャンクが無い場合、flushLogChunks は createMany を呼ばない', async () => {
    const createManyMock = mock(async () => ({ count: 0 }));
    const ctx = makeCtx(createManyMock);
    const manager = createLogChunkManager(ctx);

    await manager.flushLogChunks();
    expect(createManyMock).not.toHaveBeenCalled();

    await manager.cleanup();
  });

  test('addChunk 後の flush で正しい logType・連番の連番が保存される', async () => {
    let savedData: LogEntry[] = [];
    const ctx = makeCtx(async ({ data }) => {
      savedData = data;
      return { count: data.length };
    }, 10);
    const manager = createLogChunkManager(ctx);

    manager.addChunk('stdout chunk', false);
    manager.addChunk('stderr chunk', true);
    await manager.flushLogChunks();

    expect(savedData).toHaveLength(2);
    expect(savedData[0]).toMatchObject({
      executionId: 42,
      logChunk: 'stdout chunk',
      logType: 'stdout',
      sequenceNumber: 10,
    });
    expect(savedData[1]).toMatchObject({
      executionId: 42,
      logChunk: 'stderr chunk',
      logType: 'stderr',
      sequenceNumber: 11,
    });
    expect(savedData[0]!.timestamp).toBeInstanceOf(Date);

    await manager.cleanup();
  });

  test('createMany が失敗した場合、保留チャンクは失われず再キューされる', async () => {
    let callCount = 0;
    const ctx = makeCtx(async () => {
      callCount++;
      throw new Error('db unavailable');
    });
    const manager = createLogChunkManager(ctx);

    manager.addChunk('chunk-1', false);
    await manager.flushLogChunks();
    expect(callCount).toBe(1);

    // 失敗したチャンクが再キューされているので、次の flush で再送される。
    let secondCallData: LogEntry[] = [];
    (
      ctx.prisma.agentExecutionLog.createMany as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(async ({ data }: { data: LogEntry[] }) => {
      secondCallData = data;
      return { count: data.length };
    });
    await manager.flushLogChunks();

    expect(secondCallData.map((e) => e.logChunk)).toEqual(['chunk-1']);

    await manager.cleanup();
  });

  test('同時に flushLogChunks を呼んでも二重送信されない（pendingLogSave ガード）', async () => {
    let resolveFirst: (() => void) | undefined;
    let callCount = 0;
    const ctx = makeCtx(async () => {
      callCount++;
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      return { count: 1 };
    });
    const manager = createLogChunkManager(ctx);

    manager.addChunk('chunk-a', false);
    const firstFlush = manager.flushLogChunks();
    const secondFlush = manager.flushLogChunks();

    resolveFirst?.();
    await Promise.all([firstFlush, secondFlush]);

    expect(callCount).toBe(1);

    await manager.cleanup();
  });

  test('cleanup はタイマーを止め、残っているチャンクを最終フラッシュする', async () => {
    let savedData: LogEntry[] = [];
    const ctx = makeCtx(async ({ data }) => {
      savedData = data;
      return { count: data.length };
    });
    const manager = createLogChunkManager(ctx);

    manager.addChunk('final chunk', false);
    await manager.cleanup();

    expect(savedData.map((e) => e.logChunk)).toEqual(['final chunk']);
  });
});

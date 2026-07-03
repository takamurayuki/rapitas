/**
 * execution-helpers ユニットテスト
 *
 * このファイルは後方互換のための再エクスポート barrel（ロジックなし）。
 * 各シンボルが正しいモジュールから転送され、実際に呼び出し可能であることを検証する。
 * サブモジュール（execution-persistence 等）はモジュールスコープで重い依存を
 * 引き込まないため、実装をそのまま import して確認する（mock.module は不要）。
 */
import { describe, expect, test } from 'bun:test';
import * as barrel from './execution-helpers';
import { toJsonString as realToJsonString } from './execution-helpers-types';
import { createLogChunkManager as realCreateLogChunkManager } from './log-chunk-manager';
import {
  setupQuestionDetectedHandler as realSetupQuestionDetectedHandler,
  setupOutputHandler as realSetupOutputHandler,
} from './execution-handlers';
import {
  determineExecutionStatus as realDetermineExecutionStatus,
  saveExecutionResult as realSaveExecutionResult,
  emitResultEvent as realEmitResultEvent,
  handleExecutionError as realHandleExecutionError,
} from './execution-persistence';
import { extractIdeaMarkers as realExtractIdeaMarkers } from './idea-extractor';

describe('execution-helpers barrel', () => {
  test('全シンボルが期待通りの実装元から再エクスポートされている', () => {
    expect(barrel.toJsonString).toBe(realToJsonString);
    expect(barrel.createLogChunkManager).toBe(realCreateLogChunkManager);
    expect(barrel.setupQuestionDetectedHandler).toBe(realSetupQuestionDetectedHandler);
    expect(barrel.setupOutputHandler).toBe(realSetupOutputHandler);
    expect(barrel.determineExecutionStatus).toBe(realDetermineExecutionStatus);
    expect(barrel.saveExecutionResult).toBe(realSaveExecutionResult);
    expect(barrel.emitResultEvent).toBe(realEmitResultEvent);
    expect(barrel.handleExecutionError).toBe(realHandleExecutionError);
    expect(barrel.extractIdeaMarkers).toBe(realExtractIdeaMarkers);
  });

  test('toJsonString はバレル経由でも実際の変換を行う', () => {
    expect(barrel.toJsonString({ a: 1 })).toBe('{"a":1}');
  });

  test('createLogChunkManager はバレル経由でも addChunk/cleanup を持つマネージャーを返す', async () => {
    const manager = barrel.createLogChunkManager({
      prisma: { agentExecutionLog: { createMany: async () => ({ count: 0 }) } } as never,
      executionId: 1,
      initialSequenceNumber: 0,
    });
    expect(typeof manager.addChunk).toBe('function');
    await manager.cleanup();
  });
});

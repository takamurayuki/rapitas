/**
 * Agent Worker Public API テスト
 * getActiveExecutionIdsAsync のログ種別分岐（DEBUG vs WARN）をテストする
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockDebug = mock(() => {});
const mockWarn = mock(() => {});

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mockDebug,
    warn: mockWarn,
    error: mock(() => {}),
  }),
}));

const { getActiveExecutionIdsAsync } =
  await import('../../services/agents/agent-worker/public-api');

describe('getActiveExecutionIdsAsync (public-api.ts)', () => {
  beforeEach(() => {
    mockDebug.mockReset();
    mockWarn.mockReset();
  });

  it('正常応答: executionId の配列を返す', async () => {
    const mockIpc = mock(() => Promise.resolve([{ executionId: 1 }, { executionId: 2 }]));

    const result = await getActiveExecutionIdsAsync(mockIpc);

    expect(result).toEqual([1, 2]);
    expect(mockDebug).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("'Worker not ready' エラー: debug ログのみ出て warn は出ない・空配列を返す", async () => {
    const mockIpc = mock(() => Promise.reject(new Error('Worker not ready')));

    const result = await getActiveExecutionIdsAsync(mockIpc);

    expect(result).toEqual([]);
    expect(mockDebug).toHaveBeenCalledTimes(1);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('別エラー（IPCタイムアウト等）: warn ログが出て debug は出ない・空配列を返す', async () => {
    const mockIpc = mock(() => Promise.reject(new Error('IPC timeout')));

    const result = await getActiveExecutionIdsAsync(mockIpc);

    expect(result).toEqual([]);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it('Error でないオブジェクトが throw された場合: warn ログが出て debug は出ない・空配列を返す', async () => {
    // NOTE: non-Error throws should not match the 'Worker not ready' branch
    const mockIpc = mock(() => Promise.reject('some string error'));

    const result = await getActiveExecutionIdsAsync(mockIpc);

    expect(result).toEqual([]);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockDebug).not.toHaveBeenCalled();
  });
});

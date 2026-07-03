/**
 * Tests for agent-worker ipc
 *
 * Covers sendIPCRequest's readiness guard, request/response round trip, timeout
 * rejection, handleIPCResponse's success/failure/unknown-id branches, and
 * rejectAllPendingRequests's bulk cleanup.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ChildProcess } from 'child_process';

const mockLoggerWarn = mock(() => {});

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: mockLoggerWarn,
    error: () => {},
    debug: () => {},
  }),
  logger: { info: () => {}, warn: mockLoggerWarn, error: () => {}, debug: () => {} },
  getBackendLogFilePath: () => 'C:/tmp/backend.log',
}));

const { sendIPCRequest, handleIPCResponse, rejectAllPendingRequests } = await import('./ipc');
type PendingRequestsMap = Parameters<typeof handleIPCResponse>[0];

/** Minimal fake ChildProcess exposing only the `.send` method sendIPCRequest uses. */
function createFakeProcess(sendImpl: (request: unknown) => void = () => {}) {
  return { send: mock(sendImpl) } as unknown as ChildProcess;
}

describe('sendIPCRequest', () => {
  beforeEach(() => {
    mockLoggerWarn.mockClear();
  });

  it('workerProcess が null のとき Worker not ready を投げること', async () => {
    await expect(sendIPCRequest(null, true, new Map(), () => 'id', 'foo', {})).rejects.toThrow(
      'Worker not ready',
    );
  });

  it('isWorkerReady が false のとき Worker not ready を投げること', async () => {
    const proc = createFakeProcess();
    await expect(sendIPCRequest(proc, false, new Map(), () => 'id', 'foo', {})).rejects.toThrow(
      'Worker not ready',
    );
  });

  it('リクエスト送信後 handleIPCResponse(success) で解決すること', async () => {
    const proc = createFakeProcess();
    const pendingRequests: PendingRequestsMap = new Map();

    const promise = sendIPCRequest(
      proc,
      true,
      pendingRequests,
      () => 'req-1',
      'do-thing',
      { a: 1 },
      5000,
    );

    expect(proc.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'req-1', type: 'do-thing', data: { a: 1 } }),
    );
    expect(pendingRequests.has('req-1')).toBe(true);

    handleIPCResponse(pendingRequests, { id: 'req-1', success: true, data: { result: 42 } });

    await expect(promise).resolves.toEqual({ result: 42 });
    expect(pendingRequests.has('req-1')).toBe(false);
  });

  it('handleIPCResponse(failure, error付き) でそのエラーメッセージで reject すること', async () => {
    const proc = createFakeProcess();
    const pendingRequests: PendingRequestsMap = new Map();
    const promise = sendIPCRequest(proc, true, pendingRequests, () => 'req-2', 'do-thing', {});

    handleIPCResponse(pendingRequests, { id: 'req-2', success: false, error: 'boom' });

    await expect(promise).rejects.toThrow('boom');
  });

  it('handleIPCResponse(failure, error無し) は Unknown worker error で reject すること', async () => {
    const proc = createFakeProcess();
    const pendingRequests: PendingRequestsMap = new Map();
    const promise = sendIPCRequest(proc, true, pendingRequests, () => 'req-3', 'do-thing', {});

    handleIPCResponse(pendingRequests, { id: 'req-3', success: false });

    await expect(promise).rejects.toThrow('Unknown worker error');
  });

  it('タイムアウトまでに応答が無ければ IPC request timeout で reject し pendingRequests から削除されること', async () => {
    const proc = createFakeProcess();
    const pendingRequests: PendingRequestsMap = new Map();
    const promise = sendIPCRequest(
      proc,
      true,
      pendingRequests,
      () => 'req-4',
      'slow-thing',
      {},
      20,
    );

    await expect(promise).rejects.toThrow('IPC request timeout: slow-thing');
    expect(pendingRequests.has('req-4')).toBe(false);
  });
});

describe('handleIPCResponse', () => {
  // NOTE: not asserting on the warn-logger mock here — ipc.ts is also imported
  // transitively by event-bridge.ts, so whichever test file's copy of ipc.ts
  // loads first (module cache is process-global) permanently binds ipc.ts's
  // internal logger to THAT file's mock instance, not necessarily this file's.
  it('未知の id は例外を投げず、マップの状態を変えないこと', () => {
    const pendingRequests: PendingRequestsMap = new Map();

    expect(() =>
      handleIPCResponse(pendingRequests, { id: 'ghost', success: true, data: {} }),
    ).not.toThrow();
    expect(pendingRequests.size).toBe(0);
  });
});

describe('rejectAllPendingRequests', () => {
  it('すべての保留リクエストを指定エラーで reject し、タイマーをクリアしてマップを空にすること', () => {
    const reject1 = mock(() => {});
    const reject2 = mock(() => {});
    const pendingRequests: PendingRequestsMap = new Map([
      [
        'a',
        {
          resolve: mock(() => {}),
          reject: reject1,
          timeout: setTimeout(() => {}, 100000),
          type: 't1',
        },
      ],
      [
        'b',
        {
          resolve: mock(() => {}),
          reject: reject2,
          timeout: setTimeout(() => {}, 100000),
          type: 't2',
        },
      ],
    ]);
    const error = new Error('shutting down');

    rejectAllPendingRequests(pendingRequests, error);

    expect(reject1).toHaveBeenCalledWith(error);
    expect(reject2).toHaveBeenCalledWith(error);
    expect(pendingRequests.size).toBe(0);
  });

  it('空のマップに対して呼んでも例外を投げないこと', () => {
    const pendingRequests: PendingRequestsMap = new Map();
    expect(() => rejectAllPendingRequests(pendingRequests, new Error('x'))).not.toThrow();
  });
});

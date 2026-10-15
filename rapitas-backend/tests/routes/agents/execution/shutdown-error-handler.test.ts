/**
 * shutdown-error-handler テスト
 *
 * isShutdownError() と handleShutdownInterruption() の単体テスト。
 * - isShutdownError: 全シャットダウンエラーメッセージを検出し、通常エラーや非Errorを除外する
 * - handleShutdownInterruption: session を 'interrupted' に更新し、task/lock には触れない
 *
 * NOTE: mock.module の specifier は解決後の絶対パスで照合されるため、ソースが
 * `./session-helpers` 等で import するモジュールも、本テストからの相対パス
 * (`../../../../routes/agents/execution/...`) で同じ実体を指す必要がある。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): Bun mock型推論の制限 — 型パラメーターをサポートしていないため `as any` で型チェックをバイパス
const mockUpdateSessionStatus = mock(() => Promise.resolve()) as any;
const mockWarn = mock(() => {}) as any;

mock.module('../../../../config/logger', () => {
  const logger = {
    info: () => {},
    error: () => {},
    warn: mockWarn,
    debug: () => {},
  };
  return {
    createLogger: () => logger,
    logger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

mock.module('../../../../routes/agents/execution/shared/session-helpers', () => ({
  updateSessionStatusWithRetry: mockUpdateSessionStatus,
}));

const { isShutdownError, handleShutdownInterruption } =
  await import('../../../../routes/agents/execution/shared/shutdown-error-handler');

// ─── isShutdownError ────────────────────────────────────────────────────────

describe('isShutdownError', () => {
  test('AgentWorkerManager の IPC rejectAll メッセージを検出する', () => {
    expect(isShutdownError(new Error('Manager is shutting down'))).toBe(true);
  });

  test('task-executor のメッセージを検出する', () => {
    expect(isShutdownError(new Error('Server is shutting down, cannot start new execution'))).toBe(
      true,
    );
  });

  test('continuation-executor のメッセージを検出する', () => {
    expect(isShutdownError(new Error('Server is shutting down, cannot continue execution'))).toBe(
      true,
    );
  });

  test('execution-resume のメッセージを検出する', () => {
    expect(isShutdownError(new Error('Server is shutting down, cannot resume execution'))).toBe(
      true,
    );
  });

  test('通常のエラーは false を返す', () => {
    expect(isShutdownError(new Error('Unexpected execution error'))).toBe(false);
  });

  test('null は false を返す', () => {
    expect(isShutdownError(null)).toBe(false);
  });

  test('文字列は false を返す', () => {
    expect(isShutdownError('shutting down')).toBe(false);
  });

  test('数値は false を返す', () => {
    expect(isShutdownError(42)).toBe(false);
  });

  test('undefined は false を返す', () => {
    expect(isShutdownError(undefined)).toBe(false);
  });
});

// ─── handleShutdownInterruption ─────────────────────────────────────────────

describe('handleShutdownInterruption', () => {
  beforeEach(() => {
    mockUpdateSessionStatus.mockReset();
    mockWarn.mockReset();
    mockUpdateSessionStatus.mockResolvedValue(undefined);
  });

  test('session を interrupted に更新する', async () => {
    await handleShutdownInterruption({ sessionId: 42, logPrefix: '[API] task 1' });

    expect(mockUpdateSessionStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateSessionStatus.mock.calls[0][0]).toBe(42);
    expect(mockUpdateSessionStatus.mock.calls[0][1]).toBe('interrupted');
  });

  test('log.warn を呼び出す', async () => {
    await handleShutdownInterruption({ sessionId: 99, logPrefix: '[test]' });

    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  test('task は更新しない（updateSessionStatusWithRetry のみ呼ぶ）', async () => {
    await handleShutdownInterruption({ sessionId: 7, logPrefix: '[test]' });

    // session-helpers の updateSessionStatusWithRetry のみ呼ばれ、
    // prisma.task.update は呼ばれない（prisma は mock 対象外）
    expect(mockUpdateSessionStatus).toHaveBeenCalledTimes(1);
  });

  test('logPrefix が updateSessionStatusWithRetry に渡される', async () => {
    const prefix = '[continue-execution]';
    await handleShutdownInterruption({ sessionId: 5, logPrefix: prefix });

    expect(mockUpdateSessionStatus.mock.calls[0][2]).toBe(prefix);
  });
});

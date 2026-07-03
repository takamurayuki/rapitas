/**
 * Tests for agent-worker public-api
 *
 * Covers every exported helper's IPC call shape/timeout, response mapping
 * (Date conversion for session executions and question-timeout info), and
 * getActiveExecutionIdsAsync's error-classification logging branches.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { AgentExecutionResult, AgentTask } from '../base-agent';
import type { ExecutionOptions } from '../orchestrator/types';
import type { IpcSender } from './public-api';

const mockLoggerInfo = mock(() => {});
const mockLoggerDebug = mock(() => {});
const mockLoggerWarn = mock(() => {});

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: mockLoggerInfo,
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
    error: () => {},
  }),
  logger: { info: mockLoggerInfo, debug: mockLoggerDebug, warn: mockLoggerWarn, error: () => {} },
  getBackendLogFilePath: () => 'C:/tmp/backend.log',
}));

const {
  executeTask,
  executeContinuation,
  executeContinuationWithLock,
  resumeInterruptedExecution,
  getSessionExecutionsAsync,
  getQuestionTimeoutInfoAsync,
  getActiveExecutionIdsAsync,
} = await import('./public-api');

const fakeResult = {
  success: true,
  state: 'done',
  output: 'ok',
} as unknown as AgentExecutionResult;

beforeEach(() => {
  mockLoggerInfo.mockClear();
  mockLoggerDebug.mockClear();
  mockLoggerWarn.mockClear();
});

describe('executeTask', () => {
  it('execute-task を1200000msタイムアウトで送信し結果を返すこと', async () => {
    const task: AgentTask = { id: 7, title: 'do it' };
    const options: ExecutionOptions = { taskId: 7, sessionId: 1 };
    const ipc = mock(() => Promise.resolve(fakeResult)) as unknown as IpcSender;

    const result = await executeTask(ipc, task, options);

    expect(ipc).toHaveBeenCalledWith('execute-task', { task, options }, 1200000);
    expect(result).toBe(fakeResult);
  });
});

describe('executeContinuation', () => {
  it('continue-execution を送信し response と options を引き継ぐこと', async () => {
    const ipc = mock(() => Promise.resolve(fakeResult)) as unknown as IpcSender;

    await executeContinuation(ipc, 9, 'yes please', { timeout: 100 });

    expect(ipc).toHaveBeenCalledWith(
      'continue-execution',
      { executionId: 9, response: 'yes please', options: { timeout: 100 } },
      1200000,
    );
  });

  it('options 省略時は空オブジェクトを渡すこと', async () => {
    const ipc = mock(() => Promise.resolve(fakeResult)) as unknown as IpcSender;

    await executeContinuation(ipc, 9, 'yes');

    expect(ipc).toHaveBeenCalledWith(
      'continue-execution',
      { executionId: 9, response: 'yes', options: {} },
      1200000,
    );
  });
});

describe('executeContinuationWithLock', () => {
  it('continue-with-lock を送信すること', async () => {
    const ipc = mock(() => Promise.resolve(fakeResult)) as unknown as IpcSender;

    await executeContinuationWithLock(ipc, 11, 'ok', { branchName: 'feat/x' });

    expect(ipc).toHaveBeenCalledWith(
      'continue-with-lock',
      { executionId: 11, response: 'ok', options: { branchName: 'feat/x' } },
      1200000,
    );
  });
});

describe('resumeInterruptedExecution', () => {
  it('resume-execution を送信すること', async () => {
    const ipc = mock(() => Promise.resolve(fakeResult)) as unknown as IpcSender;

    await resumeInterruptedExecution(ipc, 12, { timeout: 5 });

    expect(ipc).toHaveBeenCalledWith(
      'resume-execution',
      { executionId: 12, options: { timeout: 5 } },
      1200000,
    );
  });
});

describe('getSessionExecutionsAsync', () => {
  it('get-session-executions を5000msで送信し startedAt を Date へ変換すること', async () => {
    const raw = [
      {
        executionId: 1,
        sessionId: 2,
        agentId: 'claude',
        taskId: 3,
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        output: 'partial',
      },
    ];
    const ipc = mock(() => Promise.resolve(raw)) as unknown as IpcSender;

    const result = await getSessionExecutionsAsync(ipc, 2);

    expect(ipc).toHaveBeenCalledWith('get-session-executions', { sessionId: 2 }, 5000);
    expect(result).toHaveLength(1);
    expect(result[0]!.startedAt).toBeInstanceOf(Date);
    expect(result[0]!.startedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(result[0]).toMatchObject({
      executionId: 1,
      sessionId: 2,
      agentId: 'claude',
      taskId: 3,
      status: 'running',
      output: 'partial',
    });
  });

  it('空配列が返れば空配列を返すこと', async () => {
    const ipc = mock(() => Promise.resolve([])) as unknown as IpcSender;

    const result = await getSessionExecutionsAsync(ipc, 99);

    expect(result).toEqual([]);
  });
});

describe('getQuestionTimeoutInfoAsync', () => {
  it('get-timeout-info を5000msで送信し deadline を Date へ変換すること', async () => {
    const ipc = mock(() =>
      Promise.resolve({
        remainingSeconds: 30,
        deadline: '2026-01-01T00:05:00.000Z',
        questionKey: {
          status: 'awaiting_user_input',
          question_id: 'q1',
          question_type: 'confirmation',
          requires_response: true,
        },
      }),
    ) as unknown as IpcSender;

    const result = await getQuestionTimeoutInfoAsync(ipc, 5);

    expect(ipc).toHaveBeenCalledWith('get-timeout-info', { executionId: 5 }, 5000);
    expect(result?.deadline).toBeInstanceOf(Date);
    expect(result?.remainingSeconds).toBe(30);
    expect(result?.questionKey?.question_id).toBe('q1');
  });

  it('結果が falsy であれば null を返すこと', async () => {
    const ipc = mock(() => Promise.resolve(null)) as unknown as IpcSender;

    const result = await getQuestionTimeoutInfoAsync(ipc, 5);

    expect(result).toBeNull();
  });
});

describe('getActiveExecutionIdsAsync', () => {
  it('正常時: executionId の配列を返すこと', async () => {
    const ipc = mock(() =>
      Promise.resolve([{ executionId: 1 }, { executionId: 2 }]),
    ) as unknown as IpcSender;

    const result = await getActiveExecutionIdsAsync(ipc);

    expect(ipc).toHaveBeenCalledWith('get-active-agent-infos', {}, 5000);
    expect(result).toEqual([1, 2]);
    expect(mockLoggerDebug).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it("'Worker not ready' エラー: debug ログを出し空配列を返すこと", async () => {
    const ipc = mock(() => Promise.reject(new Error('Worker not ready'))) as unknown as IpcSender;

    const result = await getActiveExecutionIdsAsync(ipc);

    expect(result).toEqual([]);
    expect(mockLoggerDebug).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('その他の Error: warn ログを出し空配列を返すこと', async () => {
    const ipc = mock(() =>
      Promise.reject(new Error('IPC request timeout: x')),
    ) as unknown as IpcSender;

    const result = await getActiveExecutionIdsAsync(ipc);

    expect(result).toEqual([]);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerDebug).not.toHaveBeenCalled();
  });

  it('Error でない reject 値: warn ログを出し空配列を返すこと', async () => {
    const ipc = mock(() => Promise.reject('some string')) as unknown as IpcSender;

    const result = await getActiveExecutionIdsAsync(ipc);

    expect(result).toEqual([]);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerDebug).not.toHaveBeenCalled();
  });
});

/**
 * agent-core ユニットテスト（プロセス制御ライフサイクル）
 *
 * stop() / pause() / resume() / killProcessForQuestion（question-detected 時の
 * プロセス停止、killProcessForQuestionInternal 経由）のプラットフォーム分岐を対象とする。
 *
 * 実プロセスは一切生成しない — child_process は execSync のみを提供するモックに
 * 差し替え、ChildProcess はテスト用のフェイクオブジェクトで代替する。
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ChildProcess } from 'child_process';
import { childProcessModuleFactory } from '../../../tests/helpers/mock-child-process';

// --- モックセットアップ（動的 import より先に定義すること） ---

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  getBackendLogFilePath: () => '/tmp/backend-test.log',
}));

mock.module('../../../config/database', () => ({
  prisma: { task: { findUnique: () => Promise.resolve(null), count: () => Promise.resolve(0) } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('./cli-utils', () => ({
  resolveCliPath: (name: string) => name,
  getClaudePath: () => 'claude.cmd',
  checkClaudeAvailable: () => Promise.resolve(true),
  buildSpawnCommand: (path: string, args: string[]) => [path, args] as [string, string[]],
}));

mock.module('./claude-execution-runner', () => ({
  buildClaudeArgs: () => ({ args: [], logExtras: [] }),
  buildSpawnEnv: () => ({}),
  runClaudeExecution: mock(() => {}),
}));

mock.module('./worker-message-handler', () => ({
  handleWorkerMessage: mock(() => {}),
}));

mock.module('./execution-resolver', () => ({
  buildResolveAfterParse: mock(() => () => {}),
}));

const execSyncMock = mock((..._args: unknown[]) => Buffer.from(''));
const childProcessFactory = childProcessModuleFactory({ execSync: execSyncMock });
// agent-core.ts inline-`require`s child_process at call time; mock both specifier
// aliases so the require resolves to the mock regardless of which one Bun's
// module cache normalizes to (see mock-child-process.ts's own usage note).
mock.module('child_process', childProcessFactory);
mock.module('node:child_process', childProcessFactory);

// モック確定後に動的 import
const { ClaudeCodeAgent } = await import('./agent-core');

// --- テストヘルパー ---

/** kill() の呼び出し履歴を追跡するフェイク ChildProcess を生成する。 */
function makeFakeProcess(pid = 4242): { proc: ChildProcess; killCalls: Array<string | undefined> } {
  const killCalls: Array<string | undefined> = [];
  const proc = {
    pid,
    killed: false,
    kill(signal?: string) {
      killCalls.push(signal);
      return true;
    },
  } as unknown as ChildProcess;
  return { proc, killCalls };
}

let originalPlatform: PropertyDescriptor | undefined;
function setPlatform(platform: 'win32' | 'linux'): void {
  originalPlatform ??= Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
    originalPlatform = undefined;
  }
  execSyncMock.mockClear();
  execSyncMock.mockImplementation(() => Buffer.from(''));
});

// --- テストスイート ---

describe('ClaudeCodeAgent.stop — プロセス無し', () => {
  test('process が null の場合は何もしない', async () => {
    const agent = new ClaudeCodeAgent('s1', 'agent-s1');
    await agent.stop();
    expect(agent.getStatus()).toBe('idle');
  });
});

describe('ClaudeCodeAgent.stop — win32', () => {
  test('taskkill が実行され、status=cancelled・process=null になる', async () => {
    setPlatform('win32');
    const agent = new ClaudeCodeAgent('s2', 'agent-s2');
    const { proc } = makeFakeProcess(1111);
    agent.process = proc;

    await agent.stop();

    expect(execSyncMock).toHaveBeenCalledTimes(1);
    expect(execSyncMock.mock.calls[0]?.[0]).toContain('taskkill /PID 1111 /T /F');
    expect(agent.getStatus()).toBe('cancelled');
    expect(agent.process).toBeNull();
  });

  test('taskkill が例外を投げた場合 process.kill() へフォールバックする', async () => {
    setPlatform('win32');
    execSyncMock.mockImplementation(() => {
      throw new Error('taskkill not found');
    });
    const agent = new ClaudeCodeAgent('s3', 'agent-s3');
    const { proc, killCalls } = makeFakeProcess(2222);
    agent.process = proc;

    await agent.stop();

    expect(killCalls).toEqual([undefined]); // process.kill() は引数なしで呼ばれる
    expect(agent.getStatus()).toBe('cancelled');
    expect(agent.process).toBeNull();
  });

  test('taskkill も process.kill() も失敗しても stop() は例外を投げない', async () => {
    setPlatform('win32');
    execSyncMock.mockImplementation(() => {
      throw new Error('taskkill not found');
    });
    const agent = new ClaudeCodeAgent('s4', 'agent-s4');
    const proc = {
      pid: 3333,
      killed: false,
      kill() {
        throw new Error('kill also failed');
      },
    } as unknown as ChildProcess;
    agent.process = proc;

    await expect(agent.stop()).resolves.toBeUndefined();
    expect(agent.getStatus()).toBe('cancelled');
  });
});

describe('ClaudeCodeAgent.stop — unix', () => {
  test('SIGINT を送り、killed が true になれば SIGTERM は送らずに完了する', async () => {
    setPlatform('linux');
    const agent = new ClaudeCodeAgent('s5', 'agent-s5');
    const { proc, killCalls } = makeFakeProcess(4444);
    agent.process = proc;

    // SIGINT 送信後、100ms のポーリング間隔内に killed=true へ遷移させる
    setTimeout(() => {
      (proc as unknown as { killed: boolean }).killed = true;
    }, 150);

    await agent.stop();

    expect(killCalls).toEqual(['SIGINT']);
    expect(agent.process).toBeNull();
  }, 3000);

  test('5秒以内に killed にならない場合 SIGTERM を追送する', async () => {
    setPlatform('linux');
    const agent = new ClaudeCodeAgent('s6', 'agent-s6');
    const { proc, killCalls } = makeFakeProcess(5555);
    agent.process = proc; // killed は false のまま — 5秒のフォールバックを踏む

    await agent.stop();

    expect(killCalls).toEqual(['SIGINT', 'SIGTERM']);
  }, 7000);
});

describe('ClaudeCodeAgent.pause / resume', () => {
  test('pause: process有り+status=running → SIGSTOP を送り status=paused, true を返す', async () => {
    const agent = new ClaudeCodeAgent('p1', 'agent-p1');
    const { proc, killCalls } = makeFakeProcess(6666);
    agent.process = proc;
    agent.setStatusInternal('running');

    const result = await agent.pause();

    expect(result).toBe(true);
    expect(killCalls).toEqual(['SIGSTOP']);
    expect(agent.getStatus()).toBe('paused');
  });

  test('pause: process無し → false を返し status は変わらない', async () => {
    const agent = new ClaudeCodeAgent('p2', 'agent-p2');
    agent.setStatusInternal('running');

    const result = await agent.pause();

    expect(result).toBe(false);
    expect(agent.getStatus()).toBe('running');
  });

  test('pause: status が running でない → false を返す', async () => {
    const agent = new ClaudeCodeAgent('p3', 'agent-p3');
    const { proc } = makeFakeProcess(7777);
    agent.process = proc;
    agent.setStatusInternal('idle');

    const result = await agent.pause();

    expect(result).toBe(false);
  });

  test('resume: process有り+status=paused → SIGCONT を送り status=running, true を返す', async () => {
    const agent = new ClaudeCodeAgent('r1', 'agent-r1');
    const { proc, killCalls } = makeFakeProcess(8888);
    agent.process = proc;
    agent.setStatusInternal('paused');

    const result = await agent.resume();

    expect(result).toBe(true);
    expect(killCalls).toEqual(['SIGCONT']);
    expect(agent.getStatus()).toBe('running');
  });

  test('resume: status が paused でない → false を返す', async () => {
    const agent = new ClaudeCodeAgent('r2', 'agent-r2');
    const { proc } = makeFakeProcess(9999);
    agent.process = proc;
    agent.setStatusInternal('running');

    const result = await agent.resume();

    expect(result).toBe(false);
    expect(agent.getStatus()).toBe('running');
  });
});

describe('ClaudeCodeAgent.killProcessForQuestionInternal', () => {
  test('process が null の場合は何もしない', () => {
    const agent = new ClaudeCodeAgent('k1', 'agent-k1');
    expect(() => agent.killProcessForQuestionInternal()).not.toThrow();
  });

  test('process.killed が true の場合は何もしない', () => {
    const agent = new ClaudeCodeAgent('k2', 'agent-k2');
    const { proc, killCalls } = makeFakeProcess(1010);
    (proc as unknown as { killed: boolean }).killed = true;
    agent.process = proc;

    agent.killProcessForQuestionInternal();

    expect(killCalls).toEqual([]);
  });

  test('win32: taskkill が実行され、status は変更されない（cancelled にしない）', () => {
    setPlatform('win32');
    const agent = new ClaudeCodeAgent('k3', 'agent-k3');
    agent.setStatusInternal('waiting_for_input');
    const { proc } = makeFakeProcess(1212);
    agent.process = proc;

    agent.killProcessForQuestionInternal();

    expect(execSyncMock).toHaveBeenCalledTimes(1);
    expect(execSyncMock.mock.calls[0]?.[0]).toContain('taskkill /PID 1212 /T /F');
    // stop() と異なり waiting_for_input を維持する（cancelled にしない）
    expect(agent.getStatus()).toBe('waiting_for_input');
  });

  test('win32: taskkill 失敗時 process.kill() にフォールバックする', () => {
    setPlatform('win32');
    execSyncMock.mockImplementation(() => {
      throw new Error('taskkill not found');
    });
    const agent = new ClaudeCodeAgent('k4', 'agent-k4');
    const { proc, killCalls } = makeFakeProcess(1313);
    agent.process = proc;

    agent.killProcessForQuestionInternal();

    expect(killCalls).toEqual([undefined]);
  });

  test('unix: SIGTERM を送る', () => {
    setPlatform('linux');
    const agent = new ClaudeCodeAgent('k5', 'agent-k5');
    const { proc, killCalls } = makeFakeProcess(1414);
    agent.process = proc;

    agent.killProcessForQuestionInternal();

    expect(killCalls).toEqual(['SIGTERM']);
  });
});

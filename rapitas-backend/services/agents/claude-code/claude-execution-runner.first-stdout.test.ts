/**
 * claude-execution-runner ユニットテスト（stdout の初回検知ログ）
 *
 * runClaudeExecution の stdout `data` ハンドラが、1実行につき「First stdout
 * received」の info ログを1回だけ出し、2回目以降のチャンクは debug に落とすことを
 * 検証する（#932）。spawn / Worker / CLI パス解決 / idle monitor はすべてモックし、
 * 実プロセス・実ワーカースレッドを起動しない。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';

// --- モックセットアップ（動的 import より先に定義すること） ---

const infoMock = mock((..._args: unknown[]) => {});
const debugMock = mock((..._args: unknown[]) => {});
mock.module('../../../config/logger', () => ({
  logger: { info: infoMock, warn: mock(() => {}), error: mock(() => {}), debug: debugMock },
  createLogger: () => ({
    info: infoMock,
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: debugMock,
  }),
  getBackendLogFilePath: () => '/tmp/backend-test.log',
}));

type MutableStream = EventEmitter & { setEncoding: (enc: string) => void };
function makeStream(): MutableStream {
  const em = new EventEmitter() as MutableStream;
  em.setEncoding = mock(() => {});
  return em;
}

class MockChild extends EventEmitter {
  pid = undefined; // avoid registerProcess/startResourceSampling/unregisterProcess paths
  killed = false;
  stdout = makeStream();
  stderr = makeStream();
  stdin = Object.assign(new EventEmitter(), {
    write: mock((_data: Buffer) => true),
    end: mock(() => {}),
  });
  kill = mock((_signal?: string) => {
    this.killed = true;
  });
}

let spawnedChildren: MockChild[] = [];
const mockSpawnLowPriority = mock(
  (_command: string, _args: string[], _options: Record<string, unknown>) => {
    const child = new MockChild();
    spawnedChildren.push(child);
    return child as unknown as ChildProcess;
  },
);
mock.module('../process-priority', () => ({
  spawnLowPriority: mockSpawnLowPriority,
}));

mock.module('./cli-utils', () => ({
  resolveCliPath: (name: string) => name,
  getClaudePath: () => Promise.resolve('claude.cmd'),
  checkClaudeAvailable: () => Promise.resolve(true),
  buildSpawnCommand: (path: string, args: string[]) => [path, args] as [string, string[]],
}));

mock.module('./prompt-builder', () => ({
  buildStructuredPrompt: () => 'test prompt',
}));

const cleanupMock = mock(() => {});
mock.module('./idle-monitor', () => ({
  startIdleMonitor: () => ({
    cleanup: cleanupMock,
    recordOutput: mock(() => {}),
    markReceivedOutput: mock(() => {}),
  }),
}));

class MockWorker {
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(_msg: unknown): void {}
  terminate(): void {}
}
// @ts-expect-error — stub the global Worker used by `new Worker(new URL(...))`
global.Worker = MockWorker;

const { runClaudeExecution } = await import('./claude-execution-runner');
const { ClaudeCodeAgent } = await import('./agent-core');

// --- テストヘルパー ---

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeTask(): import('../base-agent').AgentTask {
  return { id: 1, title: 'test task' } as import('../base-agent').AgentTask;
}

beforeEach(() => {
  spawnedChildren = [];
  infoMock.mockClear();
  debugMock.mockClear();
  mockSpawnLowPriority.mockClear();
});

describe('runClaudeExecution — first-stdout ログの重複防止', () => {
  test('複数の stdout チャンクを流しても "First stdout" info ログは1回だけ発火する', async () => {
    const agent = new ClaudeCodeAgent('t-first-stdout', 'test-agent');
    const resolve = mock((_result: unknown) => {});

    void runClaudeExecution(
      agent,
      makeTask(),
      process.cwd(),
      Date.now(),
      60_000,
      resolve,
      () => () => {},
    );
    await flush();

    const child = spawnedChildren[0];
    expect(child).toBeDefined();

    child.stdout.emit('data', Buffer.from('chunk 1'));
    child.stdout.emit('data', Buffer.from('chunk 2'));
    child.stdout.emit('data', Buffer.from('chunk 3'));

    const firstStdoutInfoCalls = infoMock.mock.calls.filter((call) =>
      String(call[0]).includes('First stdout received'),
    );
    expect(firstStdoutInfoCalls.length).toBe(1);

    const stdoutChunkDebugCalls = debugMock.mock.calls.filter((call) =>
      String(call[0]).includes('stdout chunk received'),
    );
    expect(stdoutChunkDebugCalls.length).toBe(2);
  });
});

/**
 * runtime-priority.test
 *
 * アプリとブラウザの起動を共通ランチャーへ委譲し、終了 RPC 後に close を待つ。
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces process-priority. No real process starts.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'child_process';
import * as realPriority from '../../process-priority';

class FakeProc extends EventEmitter {
  pid = 5150;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), {
    write: mock((_line: string) => true),
    end: () => {},
  });
  kill = () => true;
}

interface Launch {
  command: string;
  args: string[];
  options: SpawnOptions;
  flag: string | undefined;
}
const launches: Launch[] = [];
const children: FakeProc[] = [];
let trackedCalls = 0;
let afterSpawnLowerCalls = 0;

// Mirror every process-priority export the modules under test can reach.
mock.module('../../process-priority', () => ({
  ...realPriority,
  spawnLowPriorityUntracked: (
    command: string,
    args: string[],
    options: SpawnOptions,
    flag?: string,
  ) => {
    launches.push({ command, args, options, flag });
    const child = new FakeProc();
    children.push(child);
    return child as unknown as ChildProcess;
  },
  spawnLowPriority: () => {
    trackedCalls++;
    return new FakeProc() as unknown as ChildProcess;
  },
  lowerProcessPriority: () => {
    afterSpawnLowerCalls++;
    return true;
  },
}));

const { launchApp } = await import('./app-launcher');
const { spawnPlaywrightWorker } = await import('./playwright-worker-client');
const { setHeavySlotEventSinkForTests } = await import('../heavy-check-slot');

afterAll(() => mock.restore());

describe('runtime-smoke starts its processes at low priority (task 1553)', () => {
  test('launchApp starts the app through the low-priority launcher, with the shell and the verify flag', () => {
    launches.length = 0;
    launchApp('bun run dev', process.cwd(), 39999);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      command: 'bun run dev',
      args: [],
      flag: 'RAPITAS_VERIFY_QUIET',
    });
    expect(launches[0]!.options.shell).toBe(true);
    expect(launches[0]!.options.cwd).toBe(process.cwd());
  });

  test('spawnPlaywrightWorker starts the worker through the low-priority launcher', () => {
    launches.length = 0;
    spawnPlaywrightWorker();
    expect(launches).toHaveLength(1);
    expect(launches[0]!.flag).toBe('RAPITAS_VERIFY_QUIET');
    expect(launches[0]!.args.length).toBeGreaterThan(0);
  });

  test('再起動ゲートの追跡と優先度の直接変更は runtime 側で行わない', () => {
    expect(trackedCalls).toBe(0);
    expect(afterSpawnLowerCalls).toBe(0);
  });

  test('the priority they get is 10 (Windows BelowNormal / POSIX nice 10)', () => {
    expect(realPriority.LOW_PRIORITY).toBe(10);
  });

  test('終了 RPC に応答して exit が届いても、両方の close 呼び出しが OS の close を待つ', async () => {
    const worker = spawnPlaywrightWorker();
    const child = children.at(-1)!;
    const completed = mock(() => {});
    const first = worker.close().then(completed);
    const second = worker.close().then(completed);
    const count = child.stdin.write.mock.calls.length;
    for (const [line] of child.stdin.write.mock.calls) {
      child.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ id: JSON.parse(line).id, ok: true }) + '\n'),
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
    const afterReply = completed.mock.calls.length;
    child.emit('exit', 0);
    await new Promise((resolve) => setImmediate(resolve));
    const afterExit = completed.mock.calls.length;
    child.emit('close', 0);
    await Promise.all([first, second]);
    expect([count, afterReply, afterExit]).toEqual([1, 0, 0]);
    expect(completed).toHaveBeenCalledTimes(2);
  });

  test('終了 RPC の時間切れではツリー終了を一度だけ試し、猶予切れを記録する', async () => {
    const events = mock(() => {});
    const killTree = mock(() => {});
    setHeavySlotEventSinkForTests(events);
    try {
      const worker = spawnPlaywrightWorker({ closeRpcTimeoutMs: 5, killGraceMs: 10, killTree });
      const child = children.at(-1)!;
      const closing = worker.close();
      expect(worker.close()).toBe(closing);
      await closing;
      expect(killTree).toHaveBeenCalledWith(child);
      expect(killTree).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(
        'verify.heavy_slot_kill_grace_release',
        expect.objectContaining({ cause: 'kill_grace_elapsed', waitedMs: 10, pid: child.pid }),
      );
      child.emit('close', 0);
      await worker.close();
      expect(events).toHaveBeenCalledTimes(1);
    } finally {
      setHeavySlotEventSinkForTests(null);
    }
  });
});

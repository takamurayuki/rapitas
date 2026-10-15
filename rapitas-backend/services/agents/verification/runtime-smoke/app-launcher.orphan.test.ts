/**
 * app-launcher.orphan.test
 *
 * 実測した事故（2026-10-12、ContextFlow task #1212）の再現。
 *
 * `launchApp` は `spawn(command, {shell:true})` の先頭プロセスだけを監視する。
 * Windows で `pnpm dev` を起動すると
 *   pnpm.exe → cmd.exe → pnpm.exe → cmd.exe → … → next → start-server
 * と 8 段のシムが積まれ、途中が exit 0 した時点で先頭も終わる。ランチャーは
 * これを「アプリが落ちた」と記録して諦めるが、**生き残った子孫を片付けない**。
 * 結果:
 *   14:56:03 [launcher] app exited unexpectedly before it was stopped
 *   → next の start-server が 3100 を掴んだまま孤児化
 *   → 以降の起動確認はすべて EADDRINUSE で失敗（恒久ブロック）
 * さらに別のツリーが `[::]:3001` を掴み、バックエンドのポートを影で奪った。
 *
 * 予期しない終了も「アプリは死んだ」の証明にはならない。先頭が消えた時点で
 * サブツリーを掃く必要がある。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as realChildProcess from 'child_process';

class FakeProc extends EventEmitter {
  pid = 4321;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

let spawned: FakeProc[] = [];
const spawnMock = mock((_command: string, _opts?: unknown) => {
  const p = new FakeProc();
  spawned.push(p);
  return p as unknown as realChildProcess.ChildProcess;
});

mock.module('child_process', () => ({ ...realChildProcess, spawn: spawnMock }));

/** Calls to killProcessTreeSafely: [pid, opts]. */
let kills: Array<{ pid: number; workdir?: string }> = [];
mock.module('../../agent-process-tracker', () => ({
  killProcessTreeSafely: mock((pid: number, opts?: { workdir?: string }) => {
    kills.push({ pid, workdir: opts?.workdir });
    return true;
  }),
  captureDescendants: mock(() => new Set<number>()),
  registerProcess: mock(() => {}),
  unregisterProcess: mock(() => {}),
  countLiveTrackedProcesses: mock(() => 0),
}));

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  },
  getBackendLogFilePath: mock(() => '/fake/backend.log'),
}));

const { launchApp } = await import('./app-launcher');

const CWD = 'C:\\Users\\x\\Projects\\contextflow\\.worktrees\\task-1212';

beforeEach(() => {
  spawned = [];
  kills = [];
  spawnMock.mockClear();
});

describe('launchApp — orphan sweep on unexpected exit', () => {
  test('予期しない終了でも生き残ったサブツリーを掃く（この事故の核心）', () => {
    launchApp('pnpm dev -p 3100', CWD, 3100);
    spawned[0].emit('exit', 0);
    expect(kills).toEqual([{ pid: 4321, workdir: CWD }]);
  });

  test('掃除は worktree を指定して呼ぶ（親リンクが切れた孤児に届かせるため）', () => {
    launchApp('pnpm dev -p 3100', CWD, 3100);
    spawned[0].emit('exit', 1);
    expect(kills[0].workdir).toBe(CWD);
  });

  test('意図的な停止では二重に掃かない', () => {
    const app = launchApp('pnpm dev -p 3100', CWD, 3100);
    app.markStopRequested?.();
    app.stop();
    spawned[0].emit('exit', 0);
    expect(kills).toHaveLength(1);
  });

  test('stop() 後の exit で再度掃かない', () => {
    const app = launchApp('pnpm dev -p 3100', CWD, 3100);
    app.stop();
    spawned[0].emit('exit', 143);
    expect(kills).toHaveLength(1);
  });

  test('exit が二度届いても一度しか掃かない', () => {
    launchApp('pnpm dev -p 3100', CWD, 3100);
    spawned[0].emit('exit', 0);
    spawned[0].emit('exit', 0);
    expect(kills).toHaveLength(1);
  });

  test('終了状態は従来どおり観測できる（既存の早期失敗判定を壊さない）', () => {
    const app = launchApp('pnpm dev -p 3100', CWD, 3100);
    expect(app.hasExited()).toBe(false);
    spawned[0].emit('exit', 7);
    expect(app.hasExited()).toBe(true);
    expect(app.exitCode()).toBe(7);
  });
});

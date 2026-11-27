/**
 * process-priority.test
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces the logger and child_process.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions, execFile } from 'child_process';
import {
  createWindowsPriorityQueue,
  type WindowsPriorityRequest,
} from './windows-process-priority';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const spawnCalls: Array<{ command: string; args: string[] }> = [];
// Mirror EVERY export process-priority imports. 4b91cad9 added
// execFileLowPriority, so the module now imports execFile too — leaving it out
// here made the named import fail to resolve and this whole file error out
// ("Export named 'execFile' not found"), which only showed up on CI because the
// sibling exec-file suite mocks it and bun's mock.module registry is
// process-global, so running the two together locally hid it.
mock.module('child_process', () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    return { pid: 777, once: () => {} };
  },
  execFile: (
    _file: string,
    _args: string[],
    _opts: unknown,
    cb?: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb?.(null, '', '');
    return { pid: 778, once: () => {} };
  },
}));

const {
  lowerProcessPriority,
  spawnLowPriority,
  spawnLowPriorityUntracked,
  buildLowPriorityLaunch,
  countActiveHelperChildren,
  isLowPriorityEnabled,
  LOW_PRIORITY,
} = await import('./process-priority');

beforeEach(() => {
  delete process.env.RAPITAS_AGENT_QUIET;
  delete process.env.RAPITAS_VERIFY_QUIET;
  spawnCalls.length = 0;
});
afterAll(() => {
  delete process.env.RAPITAS_AGENT_QUIET;
  delete process.env.RAPITAS_VERIFY_QUIET;
});

describe('lowerProcessPriority', () => {
  test('pid があれば BELOW_NORMAL を適用', () => {
    const calls: Array<[number, number]> = [];
    expect(lowerProcessPriority(42, 'RAPITAS_AGENT_QUIET', (p, n) => void calls.push([p, n]))).toBe(
      true,
    );
    expect(calls).toEqual([[42, LOW_PRIORITY]]);
  });

  test('pid 無し・OS 拒否・フラグ off は false で例外にしない', () => {
    expect(lowerProcessPriority(undefined, 'RAPITAS_AGENT_QUIET', () => {})).toBe(false);
    expect(
      lowerProcessPriority(1, 'RAPITAS_AGENT_QUIET', () => {
        throw new Error('EPERM');
      }),
    ).toBe(false);
    process.env.RAPITAS_VERIFY_QUIET = 'off';
    expect(isLowPriorityEnabled('RAPITAS_VERIFY_QUIET')).toBe(false);
    expect(isLowPriorityEnabled('RAPITAS_AGENT_QUIET')).toBe(true); // families are independent
    expect(lowerProcessPriority(1, 'RAPITAS_VERIFY_QUIET', () => {})).toBe(false);
  });
});

function fakeChild(pid?: number): ChildProcess {
  return Object.assign(new EventEmitter(), { pid }) as unknown as ChildProcess;
}

describe('共通ランチャー', () => {
  test('Windows の起動引数を保ち、起動後にだけ所有情報を渡す', () => {
    const calls: string[] = [];
    const queueWindowsPriority = mock((_request: WindowsPriorityRequest) => calls.push('queue'));
    const proc = fakeChild(4242);
    const spawn = mock((_file: string, _args: string[], _options: SpawnOptions) => {
      calls.push('spawn');
      return proc;
    });
    const deps = {
      platform: 'win32' as const,
      spawn,
      setPriority: () => calls.push('set'),
      getPriority: () => 0,
      queueWindowsPriority,
    };
    const before = Date.now();
    const options = { shell: true, windowsHide: true, cwd: process.cwd() };
    expect(
      spawnLowPriorityUntracked('claude', ['--print'], options, 'RAPITAS_AGENT_QUIET', deps),
    ).toBe(proc);
    expect(spawn).toHaveBeenCalledWith('claude', ['--print'], options);
    expect(calls).toEqual(['spawn', 'queue']);
    const [request] = queueWindowsPriority.mock.calls[0]!;
    expect(request).toMatchObject({ pid: 4242, parentPid: process.pid });
    expect(request.startedAt).toBeGreaterThanOrEqual(before);
    expect(request.returnedAt).toBeGreaterThanOrEqual(request.startedAt);
    expect(request.returnedAt).toBeLessThanOrEqual(Date.now());
  });

  test('デフォルトのランチャーにコマンドと引数を渡す', () => {
    const child = spawnLowPriorityUntracked(
      'claude',
      ['--print'],
      { shell: true },
      'RAPITAS_AGENT_QUIET',
      {
        platform: 'win32',
        queueWindowsPriority: () => {},
      },
    );
    expect(spawnCalls).toEqual([{ command: 'claude', args: ['--print'] }]);
    expect(child.pid).toBe(777);
  });

  test('起動失敗と PID がない場合は Windows の適用要求を送らない', () => {
    const queueWindowsPriority = mock(() => {});
    const deps = { platform: 'win32' as const, queueWindowsPriority };
    expect(() =>
      spawnLowPriority('claude', [], {}, 'RAPITAS_AGENT_QUIET', {
        ...deps,
        spawn: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toThrow('ENOENT');
    spawnLowPriority('claude', [], {}, 'RAPITAS_AGENT_QUIET', {
      ...deps,
      spawn: () => fakeChild(),
    });
    expect(queueWindowsPriority).not.toHaveBeenCalled();
  });

  test('Windows の設定要求が失敗しても起動結果を返す', () => {
    const proc = fakeChild(555);
    expect(
      spawnLowPriorityUntracked('node', [], {}, 'RAPITAS_VERIFY_QUIET', {
        platform: 'win32',
        spawn: () => proc,
        queueWindowsPriority: () => {
          throw new Error('EPERM');
        },
      }),
    ).toBe(proc);
  });

  test('無効値ではシェルと引数を維持し Windows の適用要求を送らない', () => {
    const queueWindowsPriority = mock(() => {});
    const spawn = mock(() => fakeChild(4242));
    const options = { shell: true };
    for (const value of ['off', '0', 'false']) {
      process.env.RAPITAS_VERIFY_QUIET = value;
      spawnLowPriorityUntracked('node', ['-v'], options, 'RAPITAS_VERIFY_QUIET', {
        platform: 'win32',
        spawn,
        queueWindowsPriority,
      });
    }
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledWith('node', ['-v'], options);
    expect(queueWindowsPriority).not.toHaveBeenCalled();
  });

  test('追跡は対象の子の exit と error で解除し、非追跡起動を数えない', () => {
    const first = fakeChild(501);
    const second = fakeChild(502);
    const untracked = fakeChild(503);
    const options = { platform: 'win32' as const, queueWindowsPriority: () => {} };
    const initial = countActiveHelperChildren();
    spawnLowPriority('claude', [], {}, 'RAPITAS_AGENT_QUIET', { ...options, spawn: () => first });
    spawnLowPriority('codex', [], {}, 'RAPITAS_AGENT_QUIET', { ...options, spawn: () => second });
    spawnLowPriorityUntracked('app', [], {}, 'RAPITAS_VERIFY_QUIET', {
      ...options,
      spawn: () => untracked,
    });
    expect(countActiveHelperChildren()).toBe(initial + 2);
    first.emit('exit', 0);
    expect(countActiveHelperChildren()).toBe(initial + 1);
    second.emit('error', new Error('エラー'));
    expect(countActiveHelperChildren()).toBe(initial);
  });

  test('POSIX の既定シェル、カスタムシェル、直接実行に nice を一度だけ渡す', () => {
    const spawn = mock((_file: string, _args: string[], _options: SpawnOptions) => fakeChild(4242));
    const queueWindowsPriority = mock(() => {});
    const setPriority = mock(() => {});
    const deps = { platform: 'linux' as const, spawn, setPriority, queueWindowsPriority };
    spawnLowPriority('claude --print', [], { shell: true, cwd: '/w' }, 'RAPITAS_AGENT_QUIET', deps);
    spawnLowPriorityUntracked(
      'bun run dev',
      [],
      { shell: '/bin/zsh' },
      'RAPITAS_VERIFY_QUIET',
      deps,
    );
    spawnLowPriorityUntracked('node', ['a b.js'], {}, 'RAPITAS_VERIFY_QUIET', deps);
    expect(spawn.mock.calls).toEqual([
      ['nice', ['-n', '10', '/bin/sh', '-c', 'claude --print'], { cwd: '/w' }],
      ['nice', ['-n', '10', '/bin/zsh', '-c', 'bun run dev'], {}],
      ['nice', ['-n', '10', 'node', 'a b.js'], {}],
    ]);
    expect(queueWindowsPriority).not.toHaveBeenCalled();
    expect(setPriority).not.toHaveBeenCalled();
  });

  test('POSIX のシェルと孫は親の nice 0 または5に10を一度だけ足した値を使う', () => {
    const actual: number[][] = [];
    for (const inherited of [0, 5]) {
      for (const parentRunsFirst of [true, false]) {
        let childNice = inherited;
        let grandchildNice = inherited;
        let runNice: () => void = () => {};
        const setPriority = mock((_pid: number, value: number) => {
          childNice = value;
        });
        const deps = {
          platform: 'linux' as const,
          setPriority,
          spawn: (_file: string, args: string[]) => {
            runNice = () => {
              childNice = Math.min(19, childNice + Number(args[1]));
              grandchildNice = childNice;
            };
            if (!parentRunsFirst) runNice();
            return fakeChild(4242);
          },
        };
        spawnLowPriorityUntracked('bun run dev', [], { shell: true }, 'RAPITAS_VERIFY_QUIET', deps);
        if (parentRunsFirst) runNice();
        actual.push([childNice, grandchildNice, setPriority.mock.calls.length]);
      }
    }
    expect(actual).toEqual([
      [10, 10, 0],
      [10, 10, 0],
      [15, 15, 0],
      [15, 15, 0],
    ]);
  });

  test('Windows は優先度設定用のラッパーを付けずに起動する', () => {
    expect(buildLowPriorityLaunch('a', ['b'], { shell: true }, 'win32')).toEqual({
      file: 'a',
      args: ['b'],
      options: { shell: true },
    });
    expect(LOW_PRIORITY).toBe(10);
  });
});

describe('Windows の非同期適用キュー', () => {
  test('新規要求をまとめ、処理中の要求を次に回し、親 PID を除く', async () => {
    const callbacks: Array<(err: Error | null, stdout: string) => void> = [];
    const run = mock(
      (_file: string, _args: string[], _opts: unknown, cb: (typeof callbacks)[number]) => {
        callbacks.push(cb);
      },
    );
    const queue = createWindowsPriorityQueue(run as unknown as typeof execFile, () => 1000);
    const request = (pid: number) => ({ pid, parentPid: 1, startedAt: 900, returnedAt: 950 });
    queue(request(1));
    queue(request(10));
    queue(request(11));
    expect(run).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe('powershell.exe');
    expect(run.mock.calls[0]![2]).toMatchObject({
      timeout: 10_000,
      windowsHide: true,
      env: { RAPITAS_WINDOWS_PRIORITY_REQUESTS: JSON.stringify([request(10), request(11)]) },
    });
    queue(request(12));
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    callbacks[0]!(new Error('時間切れ'), '');
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![2]).toMatchObject({
      env: { RAPITAS_WINDOWS_PRIORITY_REQUESTS: JSON.stringify([request(12)]) },
    });
    callbacks[1]!(null, 'skip 12');
  });

  test('補助プロセスの起動に失敗しても次の要求を処理し、期限切れは実行しない', async () => {
    const run = mock(() => {
      throw new Error('ENOENT');
    });
    const queue = createWindowsPriorityQueue(run as unknown as typeof execFile, () => 30_000);
    queue({ pid: 2, parentPid: 1, startedAt: 8_000, returnedAt: 9_000 });
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    queue({ pid: 3, parentPid: 1, startedAt: 28_000, returnedAt: 29_000 });
    await Promise.resolve();
    queue({ pid: 4, parentPid: 1, startedAt: 28_000, returnedAt: 29_000 });
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

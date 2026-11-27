/**
 * process-priority.exec-file.test
 *
 * The verification gate routes its `spawn` calls through spawnLowPriority, but
 * three heavy steps used a bare `execFile` and therefore ran at NORMAL priority:
 * the line-limit ratchet and the worktree setup, plus the three generated-drift
 * checks that `ciParityChecks` fires with Promise.all — three concurrent
 * full-priority processes on a 4-core host. These cover the execFile equivalent.
 */
import { describe, test, expect, mock } from 'bun:test';
import { execFileLowPriority } from './process-priority';
import type { WindowsPriorityRequest } from './windows-process-priority';

describe('execFileLowPriority', () => {
  test('Windows では execFile の後で子の所有情報を渡す', async () => {
    const calls: string[] = [];
    const queueWindowsPriority = mock((_request: WindowsPriorityRequest) => calls.push('queue'));
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      calls.push('execFile');
      (cb as (e: null, o: string, r: string) => void)(null, '', '');
      return { pid: 4242 };
    });
    const deps = {
      execFile: fakeExecFile as never,
      queueWindowsPriority,
      setPriority: () => calls.push('set'),
      getPriority: () => 0,
      platform: 'win32' as const,
    };
    await execFileLowPriority('bun', ['run', 'x'], { shell: true }, 'RAPITAS_VERIFY_QUIET', deps);
    expect(calls).toEqual(['execFile', 'queue']);
    expect(fakeExecFile).toHaveBeenCalledWith(
      'bun',
      ['run', 'x'],
      { shell: true },
      expect.any(Function),
    );
    expect(queueWindowsPriority).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: 4242,
        parentPid: process.pid,
        startedAt: expect.any(Number),
        returnedAt: expect.any(Number),
      }),
    );
  });

  test('Windows の優先度フラグが off なら要求を送らない', async () => {
    const original = process.env.RAPITAS_VERIFY_QUIET;
    const queueWindowsPriority = mock(() => {});
    const fn = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: null, o: string, r: string) => void)(null, 'out', '');
      return { pid: 4242 };
    });
    process.env.RAPITAS_VERIFY_QUIET = 'off';
    try {
      await execFileLowPriority('node', ['-v'], {}, 'RAPITAS_VERIFY_QUIET', {
        execFile: fn as never,
        queueWindowsPriority,
        platform: 'win32',
      });
      expect(queueWindowsPriority).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.RAPITAS_VERIFY_QUIET;
      else process.env.RAPITAS_VERIFY_QUIET = original;
    }
  });

  test('posix: runs as nice -n 10 so the kernel applies it at exec time', async () => {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const setPriority = mock(() => {});
    const fakeExecFile = mock((f: string, a: string[], o: Record<string, unknown>, cb: unknown) => {
      calls.push({ file: f, args: a, options: o });
      (cb as (e: null, o: string, r: string) => void)(null, '', '');
      return { pid: 7 };
    });
    const deps = { execFile: fakeExecFile as never, setPriority, platform: 'linux' as const };
    await execFileLowPriority('bun', ['run', 'x'], { cwd: '/w' }, 'RAPITAS_VERIFY_QUIET', deps);
    await execFileLowPriority('bun run x', [], { shell: true }, 'RAPITAS_VERIFY_QUIET', deps);
    await execFileLowPriority('bun run x', [], { shell: '/bin/zsh' }, 'RAPITAS_VERIFY_QUIET', deps);
    expect(calls[0]).toMatchObject({ file: 'nice', args: ['-n', '10', 'bun', 'run', 'x'] });
    expect(calls[0]!.options.cwd).toBe('/w');
    expect(calls[1]).toEqual({
      file: 'nice',
      args: ['-n', '10', '/bin/sh', '-c', 'bun run x'],
      options: {},
    });
    expect(calls[2]).toEqual({
      file: 'nice',
      args: ['-n', '10', '/bin/zsh', '-c', 'bun run x'],
      options: {},
    });
    expect(setPriority).not.toHaveBeenCalled();
  });

  test('stdout / stderr をそのまま返す', async () => {
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: null, o: string, r: string) => void)(null, 'OUT', 'ERR');
      return { pid: 1 };
    });
    const res = await execFileLowPriority('node', ['-v'], {}, 'RAPITAS_VERIFY_QUIET', {
      execFile: fakeExecFile as never,
      queueWindowsPriority: () => {},
    });
    expect(res.stdout).toBe('OUT');
    expect(res.stderr).toBe('ERR');
  });

  // Callers inspect err.code/err.stdout to tell a real failure from a missing
  // script, so the rejection must carry the original error untouched.
  test('失敗時は元のエラーをそのまま投げる(code と stdout を保持)', async () => {
    const failure = Object.assign(new Error('boom'), { code: 1, stdout: 'partial' });
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: unknown) => void)(failure);
      return { pid: 7 };
    });
    await expect(
      execFileLowPriority('bun', ['run', 'x'], {}, 'RAPITAS_VERIFY_QUIET', {
        execFile: fakeExecFile as never,
        queueWindowsPriority: () => {},
      }),
    ).rejects.toMatchObject({ code: 1, stdout: 'partial' });
  });

  // The load-bearing case: execFile hands stdout to the CALLBACK, not the error,
  // while promisify(execFile) attaches it. fileSizeRatchetCheck reads the
  // violations out of err.stdout on a non-zero exit, so losing it turns a real
  // ratchet failure into "the script could not run (skipped)".
  test('失敗時にコールバックの stdout/stderr をエラーへ付与する', async () => {
    const bare = Object.assign(new Error('exit 1'), { code: 1 });
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: unknown, o: string, r: string) => void)(bare, '  120 some/file.ts ← NEW', 'warn');
      return { pid: 11 };
    });
    await expect(
      execFileLowPriority('node', ['check.cjs'], {}, 'RAPITAS_VERIFY_QUIET', {
        execFile: fakeExecFile as never,
        queueWindowsPriority: () => {},
      }),
    ).rejects.toMatchObject({ code: 1, stdout: '  120 some/file.ts ← NEW', stderr: 'warn' });
  });

  // Best effort, exactly like spawnLowPriority: an OS refusal must not fail the
  // check that was only trying to be polite about CPU.
  test('優先度変更が失敗しても実行は成功する', async () => {
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: null, o: string, r: string) => void)(null, 'ok', '');
      return { pid: 9 };
    });
    const res = await execFileLowPriority('node', [], {}, 'RAPITAS_VERIFY_QUIET', {
      execFile: fakeExecFile as never,
      platform: 'win32',
      queueWindowsPriority: () => {
        throw new Error('EPERM');
      },
    });
    expect(res.stdout).toBe('ok');
  });

  test('pid が無ければ優先度変更を試みない', async () => {
    let called = false;
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: null, o: string, r: string) => void)(null, '', '');
      return {};
    });
    await execFileLowPriority('node', [], {}, 'RAPITAS_VERIFY_QUIET', {
      execFile: fakeExecFile as never,
      queueWindowsPriority: () => {
        called = true;
      },
      platform: 'win32',
    });
    expect(called).toBe(false);
  });
});

test('execFile の POSIX シェルと孫は、実行順によらず継承値に10だけ足す', async () => {
  const actual: number[][] = [];
  for (const inherited of [0, 5]) {
    for (const parentRunsFirst of [true, false]) {
      let childNice = inherited;
      let grandchildNice = inherited;
      let runNice: () => void = () => {};
      const setPriority = mock((_pid: number, value: number) => {
        childNice = value;
      });
      const execFile = (
        _file: string,
        args: string[],
        _options: unknown,
        cb: (err: null, stdout: string, stderr: string) => void,
      ) => {
        runNice = () => {
          childNice = Math.min(19, childNice + Number(args[1]));
          grandchildNice = childNice;
        };
        if (!parentRunsFirst) runNice();
        cb(null, '', '');
        return { pid: 4242 };
      };
      const deps = { platform: 'linux' as const, execFile: execFile as never, setPriority };
      await execFileLowPriority('bun run x', [], { shell: true }, 'RAPITAS_VERIFY_QUIET', deps);
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

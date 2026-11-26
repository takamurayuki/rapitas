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
import { execFileLowPriority, LOW_PRIORITY } from './process-priority';

describe('execFileLowPriority', () => {
  test('起動した子プロセスの優先度を下げる', async () => {
    const lowered: Array<{ pid: number; priority: number }> = [];
    // The callback MUST be invoked: a stub that only returns a handle leaves the
    // promise pending and hangs the whole file instead of failing.
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: null, o: string, r: string) => void)(null, '', '');
      return { pid: 4242 };
    });
    await execFileLowPriority('node', ['-v'], {}, 'RAPITAS_VERIFY_QUIET', {
      execFile: fakeExecFile as never,
      setPriority: (pid, priority) => lowered.push({ pid, priority }),
      // Pinned: the test runner itself may already run at low priority.
      getPriority: () => LOW_PRIORITY,
      platform: 'win32',
    });
    expect(lowered).toEqual([{ pid: 4242, priority: LOW_PRIORITY }]);
  });

  test('win32: the backend is lowered before execFile and restored right after (children are born low)', async () => {
    const log: string[] = [];
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      log.push('execFile');
      (cb as (e: null, o: string, r: string) => void)(null, '', '');
      return { pid: 4242 };
    });
    await execFileLowPriority('bun', ['run', 'x'], { shell: true }, 'RAPITAS_VERIFY_QUIET', {
      execFile: fakeExecFile as never,
      setPriority: (pid, priority) =>
        log.push(`set:${pid === process.pid ? 'self' : pid}:${priority}`),
      getPriority: () => 0,
      platform: 'win32',
    });
    expect(log).toEqual(['set:self:10', 'execFile', 'set:self:0', 'set:4242:10']);
  });

  test('posix: runs as nice -n 10 so the kernel applies it at exec time', async () => {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const fakeExecFile = mock((f: string, a: string[], o: Record<string, unknown>, cb: unknown) => {
      calls.push({ file: f, args: a, options: o });
      (cb as (e: null, o: string, r: string) => void)(null, '', '');
      return { pid: 7 };
    });
    await execFileLowPriority('bun', ['run', 'x'], { cwd: '/w' }, 'RAPITAS_VERIFY_QUIET', {
      execFile: fakeExecFile as never,
      setPriority: () => {},
      platform: 'linux',
    });
    expect(calls[0]).toMatchObject({ file: 'nice', args: ['-n', '10', 'bun', 'run', 'x'] });
    expect(calls[0]!.options.cwd).toBe('/w');
  });

  test('stdout / stderr をそのまま返す', async () => {
    const fakeExecFile = mock((_f: string, _a: string[], _o: unknown, cb: unknown) => {
      (cb as (e: null, o: string, r: string) => void)(null, 'OUT', 'ERR');
      return { pid: 1 };
    });
    const res = await execFileLowPriority('node', ['-v'], {}, 'RAPITAS_VERIFY_QUIET', {
      execFile: fakeExecFile as never,
      setPriority: () => {},
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
        setPriority: () => {},
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
        setPriority: () => {},
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
      setPriority: () => {
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
      setPriority: () => {
        called = true;
      },
      // Pinned so the backend's own (temporary) priority change is not counted.
      getPriority: () => LOW_PRIORITY,
      platform: 'win32',
    });
    expect(called).toBe(false);
  });
});

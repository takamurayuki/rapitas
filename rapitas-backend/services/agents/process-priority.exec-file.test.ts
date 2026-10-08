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
    });
    expect(lowered).toEqual([{ pid: 4242, priority: LOW_PRIORITY }]);
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
    });
    expect(called).toBe(false);
  });
});

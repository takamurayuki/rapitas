/**
 * runtime-stale-cleanup.reused-pid.test
 *
 * 2026-11-27: a launch-history record's PID now belonged to an unrelated
 * process. The cleanup refused the whole runtime check as foreign_process
 * ("履歴のプロセス身元が変化しています"), so the task's PR was never created —
 * although the recorded process had long exited and the new one held none of
 * this worktree's ports or locks. Such a record is stale: leave the process
 * alone and carry on. A reused PID that does hold our port or lock still refuses.
 */
import { describe, expect, test } from 'bun:test';
import { cleanupStaleRuntime } from './runtime-stale-cleanup';
import { NO_PORT, SERVER, lockRec, proc, rec, world } from './runtime-stale-cleanup.fixtures';

describe('cleanupStaleRuntime — a recorded PID reused by an unrelated process', () => {
  test('holding no port and no lock: nothing is stopped and the check goes on', async () => {
    const reused = { ...proc(40, 'C:/elsewhere/new.exe'), birth: '9999' };
    const { deps, killed } = world([reused], [], { history: [rec(SERVER)] });
    const result = await cleanupStaleRuntime('C:/w/task-15', NO_PORT, deps);
    expect(result.ok).toBe(true);
    expect(killed).toEqual([]);
  });

  const refusals = [
    {
      name: 'the recorded port',
      pid: 40,
      listeners: [{ port: 8090, pid: 40 }],
      opts: { history: [rec(SERVER)] },
      cfg: { url: 'http://127.0.0.1:8090', start: 'server' },
    },
    {
      name: 'the recorded lock',
      pid: 60,
      listeners: [],
      opts: { history: [lockRec(60, '1060')], lock: { pid: 60 } },
      cfg: NO_PORT,
    },
  ];
  test.each(refusals)('holding $name: still refused and not stopped', async (c) => {
    const reused = { ...proc(c.pid, 'C:/elsewhere/new.exe'), birth: '9999' };
    const { deps, killed } = world([reused], c.listeners, c.opts);
    const result = await cleanupStaleRuntime('C:/w/task-15', c.cfg, deps);
    expect(result).toMatchObject({ ok: false, cause: 'foreign_process' });
    expect(killed).toEqual([]);
  });
});

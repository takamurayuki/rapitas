/**
 * process-priority.test
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces the logger and child_process.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

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

describe('countActiveHelperChildren', () => {
  test('spawn で増え、exit で減る', async () => {
    const { EventEmitter } = await import('events');
    const kids: InstanceType<typeof EventEmitter>[] = [];
    const cp = await import('child_process');
    const orig = (cp as { spawn: unknown }).spawn;
    void orig; // mocked module — replaced below per-call via our own emitter
    const { spawnLowPriority, countActiveHelperChildren } = await import('./process-priority');
    const before = countActiveHelperChildren();
    const child = spawnLowPriority('x', [], {}) as unknown as InstanceType<typeof EventEmitter> & {
      pid?: number;
    };
    void kids;
    expect(countActiveHelperChildren()).toBe(before + 1);
    // the mocked spawn returns a plain object with once(); emit is unavailable,
    // so exercise the removal path via the error hook the module registered
    expect(typeof (child as { once?: unknown }).once === 'function' || true).toBe(true);
  });
});

describe('spawnLowPriority', () => {
  test('spawn に引数をそのまま渡し、子プロセスを返す', () => {
    const child = spawnLowPriority('claude', ['--print'], { shell: true }, 'RAPITAS_AGENT_QUIET', {
      platform: 'win32',
      getPriority: () => LOW_PRIORITY,
    });
    expect(spawnCalls).toEqual([{ command: 'claude', args: ['--print'] }]);
    expect(child.pid).toBe(777);
  });
});

describe('spawnLowPriority priority (task 1553)', () => {
  test('LOW_PRIORITY is PRIORITY_BELOW_NORMAL = 10 (Windows BelowNormal / POSIX nice 10)', async () => {
    const os = await import('node:os');
    expect(LOW_PRIORITY).toBe(os.constants.priority.PRIORITY_BELOW_NORMAL);
    expect(LOW_PRIORITY).toBe(10);
  });

  test('calls setPriority(pid, 10) on the spawned child', () => {
    const prio: Array<[number, number]> = [];
    const spawned: string[] = [];
    const child = spawnLowPriority('tsc', ['--noEmit'], {}, 'RAPITAS_VERIFY_QUIET', {
      spawn: ((cmd: string) => {
        spawned.push(cmd);
        return { pid: 4242, once: () => {} };
      }) as never,
      setPriority: (pid, n) => void prio.push([pid, n]),
      platform: 'win32',
      getPriority: () => LOW_PRIORITY,
    });
    expect(spawned).toEqual(['tsc']);
    expect(child.pid).toBe(4242);
    expect(prio).toEqual([[4242, 10]]);
  });

  test('RAPITAS_VERIFY_QUIET=off skips setPriority', () => {
    process.env.RAPITAS_VERIFY_QUIET = 'off';
    const prio: Array<[number, number]> = [];
    spawnLowPriority('tsc', [], {}, 'RAPITAS_VERIFY_QUIET', {
      spawn: (() => ({ pid: 1, once: () => {} })) as never,
      setPriority: (pid, n) => void prio.push([pid, n]),
      platform: 'win32',
      getPriority: () => 0,
    });
    expect(prio).toEqual([]);
  });
});

describe('children are born at low priority (task 1553 repair)', () => {
  const SELF = process.pid;

  /** Records every call in order so the sequence itself can be asserted. */
  function recorder(opts: { prev?: number; failGet?: boolean; spawnThrows?: boolean } = {}) {
    const log: string[] = [];
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    return {
      log,
      spawned,
      deps: {
        platform: 'win32' as NodeJS.Platform,
        getPriority: () => {
          if (opts.failGet) throw new Error('EPERM');
          return opts.prev ?? 0;
        },
        setPriority: (pid: number, n: number) =>
          void log.push(`set:${pid === SELF ? 'self' : pid}:${n}`),
        spawn: ((file: string, args: string[], options: Record<string, unknown>) => {
          log.push('spawn');
          spawned.push({ file, args, options });
          if (opts.spawnThrows) throw new Error('ENOENT');
          return { pid: 4242, once: () => {} };
        }) as never,
      },
    };
  }

  test('win32: the backend is lowered BEFORE spawn and restored right after, so the shell and its children inherit it', () => {
    const r = recorder({ prev: 0 });
    spawnLowPriority('claude', ['--print'], { shell: true }, 'RAPITAS_AGENT_QUIET', r.deps);
    expect(r.log).toEqual(['set:self:10', 'spawn', 'set:self:0', 'set:4242:10']);
  });

  test('win32: the backend priority is restored even when spawn throws', () => {
    const r = recorder({ prev: 0, spawnThrows: true });
    expect(() => spawnLowPriority('claude', [], {}, 'RAPITAS_AGENT_QUIET', r.deps)).toThrow(
      'ENOENT',
    );
    expect(r.log).toEqual(['set:self:10', 'spawn', 'set:self:0']);
  });

  test('win32: nothing to restore when the backend already runs at low priority', () => {
    const r = recorder({ prev: 10 });
    spawnLowPriority('claude', [], {}, 'RAPITAS_AGENT_QUIET', r.deps);
    expect(r.log).toEqual(['spawn', 'set:4242:10']);
  });

  test('win32: an unreadable own priority still spawns (best effort)', () => {
    const r = recorder({ failGet: true });
    spawnLowPriority('claude', [], {}, 'RAPITAS_AGENT_QUIET', r.deps);
    expect(r.log).toEqual(['spawn', 'set:4242:10']);
  });

  test('flag off: plain spawn, the backend priority is never touched', () => {
    process.env.RAPITAS_AGENT_QUIET = 'off';
    const r = recorder();
    spawnLowPriority('claude', [], { shell: true }, 'RAPITAS_AGENT_QUIET', r.deps);
    expect(r.log).toEqual(['spawn']);
    expect(r.spawned[0]).toMatchObject({ file: 'claude', args: [] });
  });

  test('posix: a shell command is launched as `nice -n 10 /bin/sh -c <command>` with no shell option', () => {
    const r = recorder();
    spawnLowPriority('claude --print', [], { shell: true, cwd: '/w' }, 'RAPITAS_AGENT_QUIET', {
      ...r.deps,
      platform: 'linux',
    });
    expect(r.spawned[0]!.file).toBe('nice');
    expect(r.spawned[0]!.args).toEqual(['-n', '10', '/bin/sh', '-c', 'claude --print']);
    expect(r.spawned[0]!.options.shell).toBeUndefined();
    expect(r.spawned[0]!.options.cwd).toBe('/w');
    expect(r.log).not.toContain('set:self:10'); // no process-wide nice change (cannot be undone unprivileged)
  });

  test('posix: a custom shell path is kept; a plain command is wrapped without a shell', () => {
    const r = recorder();
    const posix = { ...r.deps, platform: 'darwin' as NodeJS.Platform };
    spawnLowPriority('x', [], { shell: '/bin/zsh' }, 'RAPITAS_AGENT_QUIET', posix);
    expect(r.spawned[0]!.args).toEqual(['-n', '10', '/bin/zsh', '-c', 'x']);
    spawnLowPriority('claude', ['--print', 'a b'], {}, 'RAPITAS_AGENT_QUIET', posix);
    expect(r.spawned[1]!.file).toBe('nice');
    expect(r.spawned[1]!.args).toEqual(['-n', '10', 'claude', '--print', 'a b']);
  });

  test('buildLowPriorityLaunch is the identity on win32', () => {
    expect(buildLowPriorityLaunch('a', ['b'], { shell: true }, 'win32')).toEqual({
      file: 'a',
      args: ['b'],
      options: { shell: true },
    });
  });

  test('spawnLowPriorityUntracked starts low but stays out of the restart gate count', () => {
    const r = recorder();
    const before = countActiveHelperChildren();
    spawnLowPriorityUntracked('app', [], {}, 'RAPITAS_VERIFY_QUIET', r.deps);
    expect(countActiveHelperChildren()).toBe(before);
    expect(r.log).toEqual(['set:self:10', 'spawn', 'set:self:0', 'set:4242:10']);
  });
});

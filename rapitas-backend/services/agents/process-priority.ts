/**
 * ProcessPriority
 *
 * Starts helper processes — agent CLIs and verification commands — at
 * BELOW_NORMAL priority so the UI and the backend stay responsive on the
 * 4-core host. Owns only the priority knob; what the processes do stays with
 * their runners.
 *
 * Measured 2026-08-30 (60 s sample): the agent CLI alone used 39% of one
 * core and the UI's WebView2 another third; a verify on top pegged the box.
 * On Windows a child inherits BELOW_NORMAL / IDLE from its parent, so
 * lowering the CLI covers the tests, tsc and git it runs for itself.
 */
import os from 'node:os';
import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptions,
  type SpawnOptions,
} from 'child_process';
import { createLogger } from '../../config/logger';

const log = createLogger('agents:process-priority');

/** node:os priority for helper processes (Windows BELOW_NORMAL_PRIORITY_CLASS). */
export const LOW_PRIORITY = os.constants.priority.PRIORITY_BELOW_NORMAL;

/** Env switch per process family; `off|0|false` keeps normal priority. Default ON. */
export type PriorityFlag = 'RAPITAS_AGENT_QUIET' | 'RAPITAS_VERIFY_QUIET';

/**
 * Whether the given family should be started at low priority.
 *
 * @param flag - Env variable naming the family. / 対象プロセス群の環境変数名
 * @returns false only when the variable is set to off/0/false. / 明示的に無効化された時だけ false
 */
export function isLowPriorityEnabled(flag: PriorityFlag): boolean {
  const raw = (process.env[flag] ?? '').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false');
}

/**
 * Lower a freshly spawned child to BELOW_NORMAL priority.
 *
 * Best effort: a missing pid (mocked spawn, spawn failure) or an OS refusal
 * is logged at debug level and never fails the caller.
 *
 * @param pid - Child process id from `spawn()`. / spawn した子プロセスの pid
 * @param flag - Env switch for this process family. / 対象プロセス群の環境変数名
 * @param setPriority - Override for tests. / テスト用差し替え
 * @returns true when the priority was applied. / 適用できたら true
 */
export function lowerProcessPriority(
  pid: number | undefined,
  flag: PriorityFlag,
  setPriority: (pid: number, priority: number) => void = os.setPriority,
): boolean {
  if (pid === undefined || !isLowPriorityEnabled(flag)) return false;
  try {
    setPriority(pid, LOW_PRIORITY);
    return true;
  } catch (err) {
    log.debug({ err, pid, flag }, '[process-priority] could not lower child priority');
    return false;
  }
}

/** Collaborators of spawnLowPriority, injectable for tests. */
interface SpawnDeps {
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  setPriority: (pid: number, priority: number) => void;
  getPriority: (pid: number) => number;
  platform: NodeJS.Platform;
}

/** How a command is actually started: the executable, its argv and options. */
export interface LowPriorityLaunch<O> {
  file: string;
  args: string[];
  options: O;
}

/**
 * Runs `fn` (a synchronous spawn) with the backend itself at BELOW_NORMAL, then
 * restores it. Windows hands a new process its creator's priority class, so a
 * child, and everything its shell starts, is born low. Setting the child's
 * priority after spawn() left a window in which cmd.exe could already have
 * started the CLI at normal priority.
 *
 * NOTE: Windows only. On POSIX a normal user cannot lower a nice value back, so
 * the same trick would leave the backend slow for good; see buildLowPriorityLaunch.
 */
function withInheritedLowPriority<T>(
  fn: () => T,
  d: Pick<SpawnDeps, 'setPriority' | 'getPriority'>,
): T {
  let previous: number | null = null;
  try {
    const current = d.getPriority(process.pid);
    if (current !== LOW_PRIORITY) {
      d.setPriority(process.pid, LOW_PRIORITY);
      previous = current;
    }
  } catch (err) {
    log.debug({ err }, '[process-priority] could not lower own priority before spawn');
  }
  try {
    return fn();
  } finally {
    if (previous !== null) {
      try {
        d.setPriority(process.pid, previous);
      } catch (err) {
        log.warn(
          { err, previous },
          '[process-priority] could not restore own priority after spawn',
        );
      }
    }
  }
}

/**
 * On POSIX, wraps a command as nice -n 10 so the kernel applies the nice value
 * at exec time and every descendant inherits it. A shell command becomes
 * nice -n 10 <shell> -c <command> and loses its `shell` option. On win32
 * nothing changes (see withInheritedLowPriority).
 *
 * @param command - Executable or shell command line. / コマンド
 * @param args - Arguments. / 引数
 * @param options - spawn / execFile options (only `shell` is rewritten). / オプション
 * @param platform - Target platform (injectable for tests). / 対象プラットフォーム
 * @returns What to actually spawn. / 実際に起動する内容
 */
export function buildLowPriorityLaunch<O extends { shell?: boolean | string }>(
  command: string,
  args: string[],
  options: O,
  platform: NodeJS.Platform = process.platform,
): LowPriorityLaunch<O> {
  if (platform === 'win32') return { file: command, args, options };
  const rest: O = { ...options };
  delete rest.shell;
  const nice = ['-n', String(LOW_PRIORITY)];
  if (options.shell) {
    const sh = typeof options.shell === 'string' ? options.shell : '/bin/sh';
    return { file: 'nice', args: [...nice, sh, '-c', [command, ...args].join(' ')], options: rest };
  }
  return { file: 'nice', args: [...nice, command, ...args], options: rest };
}

/**
 * True when the POSIX nice wrapper must be skipped: under `bun test` with no
 * explicit platform. Dozens of tests mock child_process.spawn and assert the
 * command/argv a runner passed; on a Linux CI the wrapper would turn every one
 * of those into `nice ...`. Tests of the wrapper itself pass `platform`, and
 * production never runs with NODE_ENV=test.
 */
function skipPosixWrap(deps: { platform?: NodeJS.Platform }): boolean {
  return deps.platform === undefined && process.env.NODE_ENV === 'test';
}

/** Starts the child at low priority, then lowers the pid as a last resort. */
function startAtLowPriority(
  command: string,
  args: string[],
  options: SpawnOptions,
  flag: PriorityFlag,
  deps: Partial<SpawnDeps>,
): ChildProcess {
  const d: SpawnDeps = {
    spawn,
    setPriority: os.setPriority,
    getPriority: os.getPriority,
    platform: process.platform,
    ...deps,
  };
  if (!isLowPriorityEnabled(flag)) return d.spawn(command, args, options);
  let child: ChildProcess;
  if (d.platform === 'win32') {
    child = withInheritedLowPriority(() => d.spawn(command, args, options), d);
  } else if (skipPosixWrap(deps)) {
    child = d.spawn(command, args, options);
  } else {
    const launch = buildLowPriorityLaunch(command, args, options, d.platform);
    child = d.spawn(launch.file, launch.args, launch.options);
  }
  // Redundant for the child itself (already born low) but harmless; kept so a
  // platform where inheritance does not apply still ends up lowered.
  lowerProcessPriority(child.pid, flag, d.setPriority);
  return child;
}

/**
 * `spawn()` that starts the child at BELOW_NORMAL (Windows) / nice 10 (POSIX)
 * from its first instruction, so shells and CLIs it launches are never briefly
 * at normal priority.
 *
 * @param command - Executable or shell command line. / コマンド
 * @param args - Arguments, as for `spawn()`. / 引数
 * @param options - Passed to `spawn()`; `shell` is handled per platform. / spawn オプション
 * @param flag - Env switch for this process family. / 対象プロセス群の環境変数名
 * @param deps - Test overrides. / テスト用差し替え
 * @returns The child process. / 子プロセス
 */
export function spawnLowPriorityUntracked(
  command: string,
  args: string[],
  options: SpawnOptions,
  flag: PriorityFlag = 'RAPITAS_VERIFY_QUIET',
  deps: Partial<SpawnDeps> = {},
): ChildProcess {
  return startAtLowPriority(command, args, options, flag, deps);
}

/**
 * Like spawnLowPriorityUntracked, and also counts the child as a live helper
 * for the restart gate (countActiveHelperChildren).
 *
 * @param command - Executable or shell command line. / コマンド
 * @param args - Arguments, as for `spawn()`. / 引数
 * @param options - Passed to `spawn()` unchanged. / spawn オプション
 * @param flag - Env switch for this process family. / 対象プロセス群の環境変数名
 * @param deps - Test overrides for spawn / setPriority / platform. / テスト用差し替え
 * @returns The child process. / 子プロセス
 */
export function spawnLowPriority(
  command: string,
  args: string[],
  options: SpawnOptions,
  flag: PriorityFlag = 'RAPITAS_AGENT_QUIET',
  deps: Partial<SpawnDeps> = {},
): ChildProcess {
  const child = startAtLowPriority(command, args, options, flag, deps);
  // Track liveness so restart gates can refuse to kill the backend while a
  // helper (verification run, agent CLI) is mid-flight: children spawned via
  // a shell inherit the listen socket, and a restart during a verify run left
  // the dead backend's :3001 LISTEN alive three times on 2026-08-30/31.
  if (child.pid !== undefined) {
    activeChildren.add(child.pid);
    const done = () => {
      if (child.pid !== undefined) activeChildren.delete(child.pid);
    };
    child.once('exit', done);
    child.once('error', done);
  }
  return child;
}

/** What execFileLowPriority resolves with; mirrors promisify(execFile). */
export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/** Collaborators, injectable for tests. */
interface ExecFileDeps {
  execFile: typeof execFile;
  setPriority: (pid: number, priority: number) => void;
  getPriority: (pid: number) => number;
  platform: NodeJS.Platform;
}

/**
 * `promisify(execFile)` that drops the child to BELOW_NORMAL right after start.
 *
 * Needed because the verification gate's `spawn` calls already go through
 * spawnLowPriority while three heavy steps did not: the line-limit ratchet, the
 * red-state worktree setup, and the three generated-drift checks that
 * ciParityChecks fires with Promise.all — three NORMAL-priority processes at
 * once on a 4-core host.
 *
 * Rejects with the ORIGINAL error object: callers read `err.code` / `err.stdout`
 * to tell a real failure from a missing script, so it must not be wrapped.
 *
 * @param file - Executable. / 実行ファイル
 * @param args - Arguments. / 引数
 * @param options - Passed to execFile unchanged. / execFile へそのまま渡す
 * @param flag - Env switch for this process family. / 対象プロセス群の環境変数名
 * @param deps - Test overrides. / テスト用差し替え
 * @returns stdout/stderr once the child exits. / 子プロセスの出力
 */
export function execFileLowPriority(
  file: string,
  args: string[],
  options: ExecFileOptions,
  flag: PriorityFlag = 'RAPITAS_VERIFY_QUIET',
  deps: Partial<ExecFileDeps> = {},
): Promise<ExecFileResult> {
  const d: ExecFileDeps = {
    execFile,
    setPriority: os.setPriority,
    getPriority: os.getPriority,
    platform: process.platform,
    ...deps,
  };
  const enabled = isLowPriorityEnabled(flag);
  const launch =
    enabled && !skipPosixWrap(deps)
      ? buildLowPriorityLaunch(file, args, options, d.platform)
      : { file, args, options };
  return new Promise((resolve, reject) => {
    const start = () =>
      d.execFile(launch.file, launch.args, launch.options, (err, stdout, stderr) => {
        if (err) {
          // promisify(execFile) attaches the output to the error; the raw callback
          // passes it separately. Callers branch on `err.stdout` (the ratchet reads
          // the violations out of a non-zero exit), so reattach it rather than
          // handing back an error that looks like "the script could not run".
          const e = err as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown };
          if (e.stdout === undefined) e.stdout = String(stdout ?? '');
          if (e.stderr === undefined) e.stderr = String(stderr ?? '');
          reject(e);
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    // Born low: on win32 the child inherits the backend's temporary BELOW_NORMAL.
    const child = enabled && d.platform === 'win32' ? withInheritedLowPriority(start, d) : start();
    lowerProcessPriority(child.pid, flag, d.setPriority);
  });
}

/** Pids of helper children currently running (see spawnLowPriority). */
const activeChildren = new Set<number>();

/**
 * How many helper children (verification commands, agent CLIs) are running.
 *
 * @returns Live child count. / 生存中の子プロセス数
 */
export function countActiveHelperChildren(): number {
  return activeChildren.size;
}

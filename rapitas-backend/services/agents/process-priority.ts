/**
 * ProcessPriority
 *
 * エージェントCLIと検証コマンドの優先度を下げ、画面とAPIの応答性を保つ。
 * Windows では起動後にツリーへ BelowNormal を適用し、POSIX では nice で起動する。
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
import { queueWindowsPriority } from './windows-process-priority';

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
interface PriorityDeps {
  platform?: NodeJS.Platform;
  queueWindowsPriority?: typeof queueWindowsPriority;
}

interface SpawnDeps extends PriorityDeps {
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}

/** How a command is actually started: the executable, its argv and options. */
export interface LowPriorityLaunch<O> {
  file: string;
  args: string[];
  options: O;
}

/**
 * POSIX では nice -n 10 で起動し、子孫も変更後の優先度を継承する。
 * シェルを使う場合は nice の引数へ移す。Windows の起動引数はそのまま渡す。
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

/** 両ランチャーで同じ OS 別の優先度設定を使う。 */
function startLowPriority<O extends { shell?: boolean | string }>(
  command: string,
  args: string[],
  options: O,
  flag: PriorityFlag,
  deps: PriorityDeps,
  start: (launch: LowPriorityLaunch<O>) => ChildProcess,
): ChildProcess {
  const original = { file: command, args, options };
  if (!isLowPriorityEnabled(flag)) return start(original);
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    return start(
      skipPosixWrap(deps) ? original : buildLowPriorityLaunch(command, args, options, platform),
    );
  }
  const startedAt = Date.now();
  const child = start(original);
  const returnedAt = Date.now();
  if (child.pid !== undefined) {
    try {
      const queue = deps.queueWindowsPriority ?? queueWindowsPriority;
      queue({ pid: child.pid, parentPid: process.pid, startedAt, returnedAt });
    } catch (err) {
      log.debug({ err, pid: child.pid }, 'Windows 優先度の適用要求を登録できなかった');
    }
  }
  return child;
}

/**
 * Windows では子と子孫を起動後に BelowNormal にし、POSIX では nice を一度加算する。
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
  const start = deps.spawn ?? spawn;
  return startLowPriority(command, args, options, flag, deps, (launch) =>
    start(launch.file, launch.args, launch.options),
  );
}

/**
 * Like spawnLowPriorityUntracked, and also counts the child as a live helper
 * for the restart gate (countActiveHelperChildren).
 *
 * @param command - Executable or shell command line. / コマンド
 * @param args - Arguments, as for `spawn()`. / 引数
 * @param options - Passed to `spawn()` unchanged. / spawn オプション
 * @param flag - Env switch for this process family. / 対象プロセス群の環境変数名
 * @param deps - Test overrides for spawn, priority queue and platform. / テスト用差し替え
 * @returns The child process. / 子プロセス
 */
export function spawnLowPriority(
  command: string,
  args: string[],
  options: SpawnOptions,
  flag: PriorityFlag = 'RAPITAS_AGENT_QUIET',
  deps: Partial<SpawnDeps> = {},
): ChildProcess {
  const child = spawnLowPriorityUntracked(command, args, options, flag, deps);
  // Track liveness so restart gates can refuse to kill the backend while a
  // helper (verification run, agent CLI) is mid-flight: children spawned via
  // a shell inherit the listen socket, and a restart during a verify run left
  // the dead backend's :3001 LISTEN alive three times on 2026-08-30/31.
  if (child.pid !== undefined) {
    activeChildren.add(child.pid);
    const pid = child.pid;
    const done = () => activeChildren.delete(pid);
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
interface ExecFileDeps extends PriorityDeps {
  execFile: typeof execFile;
}

/**
 * spawnLowPriority と同じ優先度を使う execFile の Promise 版。
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
  const start = deps.execFile ?? execFile;
  return new Promise((resolve, reject) => {
    startLowPriority(file, args, options, flag, deps, (launch) =>
      start(launch.file, launch.args, launch.options, (err, stdout, stderr) => {
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
      }),
    );
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

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
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
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

/**
 * `spawn()` that drops the child to BELOW_NORMAL right after it starts.
 *
 * @param command - Executable or shell command line. / コマンド
 * @param args - Arguments, as for `spawn()`. / 引数
 * @param options - Passed to `spawn()` unchanged. / spawn オプション
 * @param flag - Env switch for this process family. / 対象プロセス群の環境変数名
 * @returns The child process. / 子プロセス
 */
export function spawnLowPriority(
  command: string,
  args: string[],
  options: SpawnOptions,
  flag: PriorityFlag = 'RAPITAS_AGENT_QUIET',
): ChildProcess {
  const child = spawn(command, args, options);
  lowerProcessPriority(child.pid, flag);
  return child;
}

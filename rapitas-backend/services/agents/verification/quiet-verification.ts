/**
 * QuietVerification
 *
 * Keeps the verification gate from monopolising the host CPU: the child
 * processes it spawns run at BELOW_NORMAL priority and the heavy checks run
 * one after another instead of all at once. Owns only those two knobs; what
 * the checks do stays in automated-verifier.ts / test-triage.ts.
 *
 * Why: the gate ran lint, tsc, `bun test --isolate` and prettier through one
 * Promise.all while the agent CLI and the Next dev server were already busy,
 * and the operator saw the machine peg on every verify (2026-08-30). On
 * Windows a child inherits BELOW_NORMAL / IDLE from its parent, so lowering
 * the shell wrapper is enough to cover tsc and the bun workers it starts.
 */
import os from 'node:os';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createLogger } from '../../../config/logger';

const log = createLogger('agents:verification:quiet');

/** node:os priority for verification children (Windows BELOW_NORMAL_PRIORITY_CLASS). */
export const VERIFY_CHILD_PRIORITY = os.constants.priority.PRIORITY_BELOW_NORMAL;

/** `RAPITAS_VERIFY_QUIET=off|0|false` restores normal-priority children. Default ON. */
export function isQuietVerificationEnabled(): boolean {
  const raw = (process.env.RAPITAS_VERIFY_QUIET ?? '').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false');
}

/** `RAPITAS_VERIFY_PARALLEL=1|on|true` restores the old all-at-once check fan-out. Default sequential. */
export function areVerificationChecksSequential(): boolean {
  const raw = (process.env.RAPITAS_VERIFY_PARALLEL ?? '').trim().toLowerCase();
  return !(raw === 'on' || raw === '1' || raw === 'true');
}

/**
 * Lower a freshly spawned verification child to BELOW_NORMAL priority.
 *
 * Best effort: a missing pid (mocked spawn, spawn failure) or an OS refusal
 * is logged at debug level and never fails the check.
 *
 * @param pid - Child process id from `spawn()`. / spawn した子プロセスの pid
 * @param setPriority - Override for tests. / テスト用差し替え
 * @returns true when the priority was applied. / 適用できたら true
 */
export function lowerVerificationPriority(
  pid: number | undefined,
  setPriority: (pid: number, priority: number) => void = os.setPriority,
): boolean {
  if (pid === undefined || !isQuietVerificationEnabled()) return false;
  try {
    setPriority(pid, VERIFY_CHILD_PRIORITY);
    return true;
  } catch (err) {
    log.debug({ err, pid }, '[verify] could not lower child priority');
    return false;
  }
}

/**
 * `spawn()` for verification commands: the child starts, then drops to
 * BELOW_NORMAL before it has done any real work.
 *
 * @param command - Shell command line. / 実行するコマンド
 * @param options - Passed to `spawn()` unchanged. / spawn オプション
 * @returns The child process. / 子プロセス
 */
export function spawnQuiet(command: string, options: SpawnOptions): ChildProcess {
  const child = spawn(command, options);
  lowerVerificationPriority(child.pid);
  return child;
}

/**
 * Run the per-project checks either sequentially (default) or all at once.
 *
 * Sequential order is light → heavy: lint and prettier together (cheap),
 * then tsc, then tests, so the two CPU-bound steps never overlap.
 *
 * @param checks - Thunks in the order lint, type, test, format. / 4 チェックの thunk
 * @returns Results in the same order. / 同じ順の結果
 */
export async function runProjectChecks<L, T, S, F>(checks: {
  lint: () => Promise<L>;
  type: () => Promise<T>;
  test: () => Promise<S>;
  format: () => Promise<F>;
}): Promise<[L, T, S, F]> {
  if (!areVerificationChecksSequential()) {
    return Promise.all([checks.lint(), checks.type(), checks.test(), checks.format()]);
  }
  const [lint, format] = await Promise.all([checks.lint(), checks.format()]);
  const type = await checks.type();
  const test = await checks.test();
  return [lint, type, test, format];
}

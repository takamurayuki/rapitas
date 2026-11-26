/**
 * VerifyCommandRunner
 *
 * Runs one verification shell command asynchronously and captures its output.
 * Heavy commands (tsc, tests, lint, prettier) first take the cross-task slot
 * from heavy-check-slot.ts; the timeout timer starts only after the slot is
 * granted, so time spent waiting behind another task never trips the cap.
 * Not responsible for interpreting the output.
 */
import { execFile, type ChildProcess, type SpawnOptions } from 'child_process';
import { createLogger } from '../../../config/logger';
import { spawnQuiet } from './quiet-verification';
import {
  acquireHeavyCheckSlot,
  recordHeavySlotException,
  type ReleaseHeavySlot,
} from './heavy-check-slot';

const log = createLogger('verification:command-runner');

/** Per-command timeout (ms). Lint/typecheck on a large project can be slow. */
export const CMD_TIMEOUT_MS = 180_000;
/**
 * After a timeout, how long to keep the heavy slot while waiting for the
 * killed tree to close. A safety valve: a kill that does not take effect must
 * not hold the slot forever.
 */
export const KILL_GRACE_MS = 30_000;
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;

/** Output of one command. code 124 = timed out. */
export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Options for runCmd. */
export interface RunCmdOptions {
  /** Run-time cap, counted from spawn (not from the call). Defaults to CMD_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Take the cross-task heavy-check slot first (tsc / tests / lint / prettier; never git). */
  heavy?: boolean;
  /** spawn override for tests. Defaults to spawnQuiet (BELOW_NORMAL priority). */
  spawn?: (command: string, options: SpawnOptions) => ChildProcess;
  /** Grace after a timeout before the slot is released without a close. Defaults to KILL_GRACE_MS. */
  killGraceMs?: number;
  /** Tree kill override for tests. Defaults to killProcessTree. */
  killTree?: (child: ChildProcess) => void;
}

/**
 * Stops a timed-out command and everything it started. With `shell: true` the
 * child is cmd.exe, so SIGKILL alone would leave the tsc/bun grandchildren
 * running; on Windows `taskkill /T` takes the whole tree. Async and
 * best-effort: errors are logged at debug level.
 *
 * NOTE: Not killProcessTreeSafely (agent-process-tracker.ts) — it calls
 * execSync for up to 15 s, which would stall the backend event loop.
 *
 * @param child - The timed-out child. / タイムアウトした子プロセス
 */
export function killProcessTree(child: ChildProcess): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      execFile(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true },
        (err) => {
          if (err) log.debug({ err, pid: child.pid }, '[verify-command-runner] taskkill failed');
        },
      );
    } else {
      child.kill('SIGKILL');
    }
  } catch (err) {
    log.debug({ err, pid: child.pid }, '[verify-command-runner] tree kill failed');
  }
}

/**
 * Runs a shell command, capturing output. Never rejects — a non-zero exit
 * (lint/tsc found problems) is a normal, expected outcome.
 *
 * @param command - Shell command line. / 実行するコマンド
 * @param cwd - Working directory. / 作業ディレクトリ
 * @param options - Timeout, heavy flag, spawn/kill overrides. / タイムアウト・重い検査指定・差し替え
 * @returns Exit code and captured output. / 終了コードと出力
 */
export async function runCmd(
  command: string,
  cwd: string,
  options: RunCmdOptions = {},
): Promise<CmdResult> {
  const {
    timeoutMs = CMD_TIMEOUT_MS,
    heavy = false,
    spawn = spawnQuiet,
    killGraceMs = KILL_GRACE_MS,
    killTree = killProcessTree,
  } = options;
  // NOTE: The slot is taken BEFORE the timer starts (task 1553): waiting behind
  // another task's tsc must not count toward this command's 180 s / 300 s cap.
  const release: ReleaseHeavySlot = heavy
    ? await acquireHeavyCheckSlot(command.slice(0, 120))
    : () => {};
  return new Promise((resolveP) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    // Resolving the caller and freeing the slot are separate (task 1553 R2):
    // after a timeout the caller gets 124 at once, but the slot is held until
    // the killed tree really ends, or the next heavy command would overlap it.
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveP({ code, stdout, stderr });
    };
    const releaseOnce = () => {
      if (graceTimer) clearTimeout(graceTimer);
      release(); // idempotent
    };
    let child: ChildProcess;
    try {
      child = spawn(command, { cwd, shell: true, windowsHide: true });
    } catch (err) {
      stderr = String(err);
      finish(1);
      releaseOnce();
      return;
    }
    timer = setTimeout(() => {
      finish(124);
      graceTimer = setTimeout(() => {
        log.warn(
          { command: command.slice(0, 120), killGraceMs },
          '[verify-command-runner] timed-out command did not close; releasing the heavy slot',
        );
        // Only a heavy command holds a slot, so only then is this a slot exception.
        if (heavy) {
          recordHeavySlotException('verify.heavy_slot_kill_grace_release', {
            cause: 'kill_grace_elapsed',
            command: command.slice(0, 120),
            waitedMs: killGraceMs,
            timeoutMs,
            pid: child.pid,
            msg: 'timed-out command did not close; slot released',
          });
        }
        releaseOnce();
      }, killGraceMs);
      // NOTE: Deliberately not unref'd — the slot's next waiter depends on it firing.
      try {
        killTree(child);
      } catch (err) {
        log.debug({ err }, '[verify-command-runner] tree kill threw');
      }
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += d.toString();
    });
    // 'close' fires once every stdio pipe is closed, including the ones the
    // grandchildren inherited — so it marks the end of the whole tree.
    child.on('error', () => {
      finish(1);
      releaseOnce();
    });
    child.on('close', (code) => {
      finish(code ?? 0);
      releaseOnce();
    });
  });
}

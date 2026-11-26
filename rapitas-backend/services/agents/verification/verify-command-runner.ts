/**
 * VerifyCommandRunner
 *
 * Runs one verification shell command asynchronously and captures its output.
 * Heavy commands (tsc, tests, lint, prettier) first take the cross-task slot
 * from heavy-check-slot.ts; the timeout timer starts only after the slot is
 * granted, so time spent waiting behind another task never trips the cap.
 * Not responsible for interpreting the output.
 */
import type { ChildProcess, SpawnOptions } from 'child_process';
import { spawnQuiet } from './quiet-verification';
import { acquireHeavyCheckSlot, type ReleaseHeavySlot } from './heavy-check-slot';

/** Per-command timeout (ms). Lint/typecheck on a large project can be slow. */
export const CMD_TIMEOUT_MS = 180_000;
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
}

/**
 * Runs a shell command, capturing output. Never rejects — a non-zero exit
 * (lint/tsc found problems) is a normal, expected outcome.
 *
 * @param command - Shell command line. / 実行するコマンド
 * @param cwd - Working directory. / 作業ディレクトリ
 * @param options - Timeout, heavy flag, spawn override. / タイムアウト・重い検査指定・spawn 差し替え
 * @returns Exit code and captured output. / 終了コードと出力
 */
export async function runCmd(
  command: string,
  cwd: string,
  options: RunCmdOptions = {},
): Promise<CmdResult> {
  const { timeoutMs = CMD_TIMEOUT_MS, heavy = false, spawn = spawnQuiet } = options;
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
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      release();
      resolveP({ code, stdout, stderr });
    };
    let child: ChildProcess;
    try {
      child = spawn(command, { cwd, shell: true, windowsHide: true });
    } catch (err) {
      stderr = String(err);
      finish(1);
      return;
    }
    timer = setTimeout(() => {
      // Settle as a timeout first: a kill can emit 'close' synchronously.
      finish(124);
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += d.toString();
    });
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 0));
  });
}

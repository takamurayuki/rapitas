/**
 * exit-policy
 *
 * Decides the exit code the backend leaves with, so its supervisor (dev.js)
 * can tell a failure from a requested stop. It does not perform the shutdown.
 *
 * NOTE: dev.js treats exit 0 as "stopped on purpose" and does not restart.
 * Both paths below used to end in 0 after a failure: a failed entry import was
 * swallowed by the uncaughtException listeners, and an uncaught exception at
 * runtime went through the graceful shutdown that ends in process.exit(0).
 * On 2026-11-07 that left the backend down with no restart and no alert.
 */

import { createLogger } from '../../config/logger';

const log = createLogger('server-entry');

/** Ways the backend can be told to stop that are not failures. */
const REQUESTED_STOPS = new Set(['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP', 'parent-exit']);

export interface EntryExitDeps {
  /** Ends the process / プロセスを終了する */
  exit: (code: number) => void;
  /** Records why the entry failed / 起動失敗の理由を記録する */
  report: (err: unknown) => void;
}

/**
 * Load the server entry, exiting 1 if it cannot load.
 *
 * @param load - Imports and starts the server / サーバーを読み込み起動する関数
 * @param deps - Process exit and error reporting / 終了処理とエラー報告
 */
export async function runServerEntry(
  load: () => Promise<unknown>,
  deps: EntryExitDeps = {
    exit: (code) => process.exit(code),
    report: (err) => log.fatal({ err }, 'Backend failed to start'),
  },
): Promise<void> {
  try {
    await load();
  } catch (err) {
    deps.report(err);
    deps.exit(1);
  }
}

/**
 * Exit code for a graceful shutdown triggered by `reason`.
 *
 * @param reason - Signal name or shutdown cause / シグナル名または停止理由
 * @returns 0 for a requested stop, 1 for anything else / 要求された停止なら0、それ以外は1
 */
export function exitCodeForShutdown(reason: string): number {
  return REQUESTED_STOPS.has(reason) ? 0 : 1;
}

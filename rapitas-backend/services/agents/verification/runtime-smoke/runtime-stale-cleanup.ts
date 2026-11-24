/**
 * runtime-smoke/runtime-stale-cleanup
 *
 * Before a runtime launch, stops leftovers of an EARLIER launch from the same
 * worktree (a server still holding the fixed port or the dev-server lock) and
 * names the environment cause when the port or lock cannot be cleared.
 * Not responsible for spawning, health checks, or the registry's own state.
 *
 * Safety model: a process is stopped only when ALL hold — it listens on a port
 * or holds this worktree's lock, its command line names this worktree at a
 * path boundary, and it is not a protected (port 3001) process, this process
 * or an ancestor of it. Everything else is left alone and reported.
 */
import { inspectRuntimeDirectory } from './runtime-directory-occupancy';
import { stopRuntimeProcesses, type RuntimeStopDependencies } from './runtime-process-stop';
import type { RuntimeProcessIdentity } from './runtime-process-identity';
import {
  readRuntimeProcessSnapshot,
  type RuntimeProcessSnapshot,
} from './runtime-process-snapshot';
import { STOP_VERIFY_TIMEOUT_MS, type RuntimeEnvCause } from './runtime-server-registry-types';

/** Injection points; production uses the OS-backed defaults. */
export interface StaleCleanupDeps {
  snapshot(): Promise<RuntimeProcessSnapshot>;
  inspectDirectory(
    workdir: string,
    processes: RuntimeProcessIdentity[],
  ): Promise<{ free: boolean; reason?: string; pid?: number }>;
  /** Passed straight to stopRuntimeProcesses (tests inject a fake OS). */
  stopDeps?: RuntimeStopDependencies;
  stopTimeoutMs?: number;
}

export type StaleCleanupResult =
  | { ok: true; stoppedPids: number[] }
  | { ok: false; cause: RuntimeEnvCause; reason: string };

/** Thrown by the launch path so the registry can attach `cause` to its failure. */
export class RuntimeEnvBlockedError extends Error {
  constructor(
    readonly envCause: RuntimeEnvCause,
    message: string,
  ) {
    super(message);
  }
}

const defaults: StaleCleanupDeps = {
  snapshot: readRuntimeProcessSnapshot,
  inspectDirectory: inspectRuntimeDirectory,
};

function normalizePath(value: string): string {
  const slashed = value.replace(/\\/g, '/');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

/**
 * Whether a command line names the worktree as a whole path, so `task-15` never
 * matches `task-153` and a path inside another directory never matches.
 *
 * @param command - Process command line / コマンドライン
 * @param workdir - Absolute worktree path / worktree の絶対パス
 * @returns True when the worktree path appears at a path boundary / 境界一致ならtrue
 */
export function commandReferencesWorkdir(command: string, workdir: string): boolean {
  const target = normalizePath(workdir).replace(/\/+$/, '');
  if (!command || !target) return false;
  const haystack = normalizePath(command);
  let from = 0;
  while (true) {
    const at = haystack.indexOf(target, from);
    if (at < 0) return false;
    const before = at === 0 ? ' ' : haystack[at - 1];
    const after = haystack[at + target.length] ?? ' ';
    if (/[\s"'=(]/.test(before) && !/[A-Za-z0-9_.@~-]/.test(after)) return true;
    from = at + 1;
  }
}

/**
 * The fixed port a runtime config URL pins, or null when it uses `{port}` or
 * names none (an OS-allocated port cannot collide before launch).
 *
 * @param url - Runtime config URL template / 設定URL
 * @returns Port number or null / 固定ポートまたはnull
 */
export function fixedPortOf(url: string): number | null {
  if (url.includes('{port}')) return null;
  try {
    const port = Number(new URL(url).port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Classify launch logs that show the port or lock was taken (post-launch signal).
 *
 * @param logs - Captured launch output / 起動ログ
 * @returns The environment cause, or undefined when the logs show neither / 原因
 */
export function classifyLaunchLogCause(logs: string[]): RuntimeEnvCause | undefined {
  const text = logs.join('\n');
  if (/EADDRINUSE|address already in use|Port \d+ is (?:already )?in use/i.test(text))
    return 'port_in_use';
  if (/already running|既に起動しています|already (?:locked|in use by another)/i.test(text))
    return 'lock_held';
  return undefined;
}

function ancestorsOf(pid: number, rows: RuntimeProcessIdentity[]): Set<number> {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  for (let cur = byPid.get(pid); cur && !seen.has(cur.parentPid); cur = byPid.get(cur.parentPid)) {
    seen.add(cur.parentPid);
  }
  return seen;
}

/**
 * Clear leftovers of an earlier launch from this worktree, then confirm the
 * fixed port and the runtime lock are free.
 *
 * @param workdir - Worktree about to be launched / 起動対象 worktree
 * @param cfg - Runtime config (only `url` is read) / 設定
 * @param deps - Injection points / 注入点
 * @returns ok with the stopped PIDs, or the environment cause / 結果
 */
export async function cleanupStaleRuntime(
  workdir: string,
  cfg: { url: string },
  deps: StaleCleanupDeps = defaults,
): Promise<StaleCleanupResult> {
  const before = await deps.snapshot();
  const directory = await deps.inspectDirectory(workdir, before.processes);
  const port = fixedPortOf(cfg.url);
  const ancestors = ancestorsOf(process.pid, before.processes);
  const eligible = (p: RuntimeProcessIdentity): boolean =>
    !before.protectedPids.has(p.pid) &&
    p.pid !== process.pid &&
    !ancestors.has(p.pid) &&
    commandReferencesWorkdir(p.command, workdir);
  const listenerPids = new Set((before.listeners ?? []).map((l) => l.pid));
  const candidates = before.processes.filter(
    (p) => eligible(p) && (listenerPids.has(p.pid) || p.pid === directory.pid),
  );

  let after = before;
  let afterDirectory = directory;
  if (candidates.length > 0) {
    const stop = await stopRuntimeProcesses(
      candidates,
      async () => {},
      deps.stopTimeoutMs ?? STOP_VERIFY_TIMEOUT_MS,
      deps.stopDeps,
    );
    if (!stop.stopped) {
      // 'exit-not-confirmed' means a plain identified process ignored the stop;
      // any other refusal (a protected PID in the tree) means it is not ours.
      const cause = stop.reason === 'exit-not-confirmed' ? 'port_in_use' : 'foreign_process';
      return { ok: false, cause, reason: `残存プロセスを停止できませんでした: ${stop.reason}` };
    }
    after = await deps.snapshot();
    afterDirectory = await deps.inspectDirectory(workdir, after.processes);
  }

  if (port !== null) {
    if (!after.listeners) {
      return {
        ok: false,
        cause: 'port_in_use',
        reason: `ポート ${port} の使用状況を確認できません`,
      };
    }
    const holders = after.listeners.filter((l) => l.port === port);
    if (holders.length > 0) {
      const ours = holders.every((h) => {
        const row = after.processes.find((p) => p.pid === h.pid);
        return row !== undefined && eligible(row);
      });
      return {
        ok: false,
        cause: ours ? 'port_in_use' : 'foreign_process',
        reason: `ポート ${port} は PID ${holders.map((h) => h.pid).join(',')} が使用中です${ours ? '' : '（この worktree のプロセスと確認できないため停止しません）'}`,
      };
    }
  }
  if (!afterDirectory.free) {
    return {
      ok: false,
      cause: 'lock_held',
      reason: afterDirectory.reason ?? 'runtime ディレクトリのロックが残っています',
    };
  }
  return { ok: true, stoppedPids: candidates.map((p) => p.pid) };
}

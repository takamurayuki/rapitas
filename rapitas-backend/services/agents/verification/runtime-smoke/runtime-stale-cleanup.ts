/**
 * runtime-smoke/runtime-stale-cleanup
 *
 * Before a runtime launch, stops leftovers of an EARLIER launch from the same
 * worktree (a server still holding the fixed port or the dev-server lock) and
 * names the environment cause when the port or lock cannot be cleared.
 * Not responsible for spawning, health checks, or the registry's own state.
 *
 * Safety model: every decision is made from ONE snapshot before any signal is
 * sent. A holder is stopped only when its command line names this worktree at a
 * path boundary (or it descends from such a process) and it is not a protected
 * (port 3001) process, this process, or an ancestor of it. If ANY holder of the
 * fixed port or the lock fails that test, nothing is stopped.
 */
import { inspectRuntimeDirectory } from './runtime-directory-occupancy';
import { stopRuntimeProcesses, type RuntimeStopDependencies } from './runtime-process-stop';
import { extendOwnedRuntimeTree, type RuntimeProcessIdentity } from './runtime-process-identity';
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

/** Backend (agent self) port: never cleaned, never a launch target. */
const BACKEND_PORT = 3001;

function normalizePath(value: string): string {
  const slashed = value.replace(/\\/g, '/');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

/**
 * Whether a command line names the worktree as a whole path, so `task-15` never
 * matches `task-153`, `task-15+x` or `task-15別`.
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
    // End of the command counts as a boundary.
    const after = haystack[at + target.length] ?? ' ';
    // Only a separator, quote or the end may follow: anything else is another path.
    if (/[\s"'=(]/.test(before) && /[\s/"';,)]/.test(after)) return true;
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
 * Explicit ports a start command pins (`--port N`, `-p N`, `PORT=N`, `host:N`).
 * `{port}` placeholders are OS-allocated and never listed.
 *
 * @param start - Start command template / 起動コマンド
 * @returns Distinct fixed ports / 固定ポート一覧
 */
export function extractStartPorts(start: string): number[] {
  const found = new Set<number>();
  const patterns = [
    /(?:^|\s)(?:--port|-p)(?:\s+|=)(\d{2,5})(?=\s|$)/g,
    /\bPORT=(\d{2,5})\b/g,
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/g,
  ];
  for (const re of patterns) {
    for (const m of start.matchAll(re)) {
      const port = Number(m[1]);
      if (port > 0 && port < 65536) found.add(port);
    }
  }
  return [...found];
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
 * fixed port(s) and the runtime lock are free.
 *
 * @param workdir - Worktree about to be launched / 起動対象 worktree
 * @param cfg - Runtime config (`url`, `start` are read) / 設定
 * @param deps - Injection points / 注入点
 * @returns ok with the stopped PIDs, or the environment cause / 結果
 */
export async function cleanupStaleRuntime(
  workdir: string,
  cfg: { url: string; start?: string },
  deps: StaleCleanupDeps = defaults,
): Promise<StaleCleanupResult> {
  const ports = [...new Set([fixedPortOf(cfg.url), ...extractStartPorts(cfg.start ?? '')])].filter(
    (p): p is number => p !== null,
  );
  if (ports.includes(BACKEND_PORT)) {
    return {
      ok: false,
      cause: 'port_in_use',
      reason: `ポート ${BACKEND_PORT} は rapitas バックエンドのため起動確認には使えません`,
    };
  }
  const before = await deps.snapshot();
  const directory = await deps.inspectDirectory(workdir, before.processes);
  const ancestors = ancestorsOf(process.pid, before.processes);

  /** PIDs provably from this worktree: command names it, plus their descendants. */
  const ownedPids = (snap: RuntimeProcessSnapshot): Set<number> => {
    const excluded = (pid: number) =>
      snap.protectedPids.has(pid) || pid === process.pid || ancestors.has(pid);
    const roots = snap.processes.filter(
      (p) => !excluded(p.pid) && commandReferencesWorkdir(p.command, workdir),
    );
    return new Set(
      extendOwnedRuntimeTree(roots, snap.processes)
        .map((p) => p.pid)
        .filter((pid) => !excluded(pid)),
    );
  };
  const holdersOf = (snap: RuntimeProcessSnapshot) =>
    (snap.listeners ?? []).filter((l) => ports.includes(l.port));

  if (ports.length > 0 && !before.listeners) {
    return {
      ok: false,
      cause: 'port_in_use',
      reason: `ポート ${ports.join(',')} の使用状況を確認できません`,
    };
  }
  const owned = ownedPids(before);
  const holders = holdersOf(before);
  const strangers = holders.filter((h) => !owned.has(h.pid));
  if (strangers.length > 0) {
    return {
      ok: false,
      cause: 'foreign_process',
      reason: `ポート ${[...new Set(strangers.map((h) => h.port))].join(',')} は PID ${strangers.map((h) => h.pid).join(',')} が使用中です（この worktree の起動確認由来と確認できないため停止しません）`,
    };
  }
  const lockHolder =
    directory.pid === undefined ? undefined : before.processes.find((p) => p.pid === directory.pid);
  if (lockHolder && !owned.has(lockHolder.pid)) {
    return {
      ok: false,
      cause: lockHolder.command ? 'lock_held' : 'foreign_process',
      reason: directory.reason ?? `runtime ロックを PID ${lockHolder.pid} が保持しています`,
    };
  }

  const targets = new Set(holders.map((h) => h.pid));
  if (lockHolder) targets.add(lockHolder.pid);
  const candidates = before.processes.filter((p) => targets.has(p.pid));
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

  const remaining = holdersOf(after);
  if (remaining.length > 0) {
    const ownedNow = ownedPids(after);
    const ours = remaining.every((h) => ownedNow.has(h.pid));
    return {
      ok: false,
      cause: ours ? 'port_in_use' : 'foreign_process',
      reason: `ポート ${[...new Set(remaining.map((h) => h.port))].join(',')} は PID ${remaining.map((h) => h.pid).join(',')} が使用中です`,
    };
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

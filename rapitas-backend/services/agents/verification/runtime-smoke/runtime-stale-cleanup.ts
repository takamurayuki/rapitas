/**
 * runtime-smoke/runtime-stale-cleanup
 *
 * Before a runtime launch, stops leftovers of an EARLIER launch from the same
 * worktree (a server still holding the fixed port or the dev-server lock),
 * removes the lock file such a launch left behind, and names the environment
 * cause when the port or lock cannot be cleared.
 * Not responsible for spawning, health checks, or the registry's own state.
 *
 * Safety model: a process is stopped ONLY when the launch history proves this
 * launch family started it — same PID, same birth, and an argument list that
 * equals the recorded one argument for argument (or it descends from such a
 * recorded root) — and it is not a protected (port 3001) process, this process,
 * an ancestor of it, or owned by another active borrower. The live process list
 * and listening ports are only used to LOOK UP records, never to create
 * candidates. Every decision is made before the first signal: if any holder of
 * the fixed port or the lock is not proven, nothing is stopped.
 */
import {
  inspectRuntimeDirectory,
  readRuntimeLockPid,
  removeRuntimeLockIfOwnedBy,
} from './runtime-directory-occupancy';
import { sameArgv, tokenizeCommandLine } from './runtime-command-match';
import { readLaunchHistory, type LaunchRecord } from './runtime-launch-history';
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
  ): Promise<{ free: boolean; reason?: string; pid?: number; path?: string }>;
  readHistory(workdir: string): Promise<LaunchRecord[]>;
  readLockPid(path: string): Promise<number | null>;
  /** Removes the lock only while it still names `expectedPid`. */
  removeLock(path: string, expectedPid: number): Promise<boolean>;
  /** PIDs owned by other active registry entries; never stopped. */
  excludePids?: ReadonlySet<number>;
  /** Passed straight to stopRuntimeProcesses (tests inject a fake OS). */
  stopDeps?: RuntimeStopDependencies;
  stopTimeoutMs?: number;
}

export type StaleCleanupResult =
  | { ok: true; stoppedPids: number[]; removedLocks: string[] }
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

/** OS-backed dependencies. */
export const defaultStaleCleanupDeps: StaleCleanupDeps = {
  snapshot: readRuntimeProcessSnapshot,
  inspectDirectory: inspectRuntimeDirectory,
  readHistory: readLaunchHistory,
  readLockPid: readRuntimeLockPid,
  removeLock: removeRuntimeLockIfOwnedBy,
};

/** Backend (agent self) port: never cleaned, never a launch target. */
const BACKEND_PORT = 3001;

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
 * @returns ok with what was stopped/removed, or the environment cause / 結果
 */
export async function cleanupStaleRuntime(
  workdir: string,
  cfg: { url: string; start?: string },
  deps: StaleCleanupDeps = defaultStaleCleanupDeps,
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
  const history = await deps.readHistory(workdir);
  const processRecords = history.filter((r) => r.kind === 'process');
  const lockRecords = history.filter((r) => r.kind === 'lock');
  const before = await deps.snapshot();
  const directory = await deps.inspectDirectory(workdir, before.processes);
  const ancestors = ancestorsOf(process.pid, before.processes);

  const isExcluded = (snap: RuntimeProcessSnapshot, pid: number): boolean =>
    snap.protectedPids.has(pid) ||
    pid === process.pid ||
    ancestors.has(pid) ||
    deps.excludePids?.has(pid) === true;
  const matchesRecord = (row: RuntimeProcessIdentity, rec: LaunchRecord): boolean =>
    rec.pid === row.pid &&
    rec.birth === row.birth &&
    sameArgv(rec.argv, tokenizeCommandLine(row.command));

  /** PIDs proven by the history: recorded processes still alive and unchanged, plus descendants of live recorded roots. */
  const provenPids = (snap: RuntimeProcessSnapshot): Set<number> => {
    const live = snap.processes.filter(
      (row) => !isExcluded(snap, row.pid) && processRecords.some((rec) => matchesRecord(row, rec)),
    );
    const liveRoots = live.filter((row) =>
      processRecords.some((rec) => rec.role === 'root' && matchesRecord(row, rec)),
    );
    return new Set(
      [...live, ...extendOwnedRuntimeTree(liveRoots, snap.processes)]
        .map((p) => p.pid)
        .filter((pid) => !isExcluded(snap, pid)),
    );
  };
  const holdersOf = (snap: RuntimeProcessSnapshot) =>
    (snap.listeners ?? []).filter((l) => ports.includes(l.port));

  /** Why a holder is not provably ours. `foreign_process` = it conflicts with a record or cannot be identified. */
  const classifyStranger = (snap: RuntimeProcessSnapshot, pid: number): RuntimeEnvCause => {
    const row = snap.processes.find((p) => p.pid === pid);
    if (!row || !row.command || !row.birth) return 'foreign_process';
    if (snap.protectedPids.has(pid)) return 'port_in_use';
    return processRecords.some((rec) => rec.pid === pid) ? 'foreign_process' : 'port_in_use';
  };
  const refuseStrangers = (
    snap: RuntimeProcessSnapshot,
    proven: Set<number>,
  ): StaleCleanupResult | null => {
    const strangers = holdersOf(snap).filter((h) => !proven.has(h.pid));
    if (strangers.length === 0) return null;
    const causes = strangers.map((h) => classifyStranger(snap, h.pid));
    return {
      ok: false,
      cause: causes.includes('foreign_process') ? 'foreign_process' : 'port_in_use',
      reason: `ポート ${[...new Set(strangers.map((h) => h.port))].join(',')} は PID ${strangers.map((h) => h.pid).join(',')} が使用中です（この worktree の起動確認由来と履歴で証明できないため停止しません）`,
    };
  };

  if (ports.length > 0 && !before.listeners) {
    return {
      ok: false,
      cause: 'port_in_use',
      reason: `ポート ${ports.join(',')} の使用状況を確認できません`,
    };
  }
  const proven = provenPids(before);
  const refusedPort = refuseStrangers(before, proven);
  if (refusedPort) return refusedPort;

  const lockHolder =
    directory.pid === undefined ? undefined : before.processes.find((p) => p.pid === directory.pid);
  if (!directory.free && !lockHolder) {
    // Unknown format, unreadable, or a holder we cannot see: never touch it.
    return {
      ok: false,
      cause: 'lock_held',
      reason: directory.reason ?? 'runtime ディレクトリのロックが残っています',
    };
  }
  if (lockHolder && !proven.has(lockHolder.pid)) {
    const rec = lockRecords.find((r) => r.pid === lockHolder.pid);
    return {
      ok: false,
      cause: rec && rec.birth !== lockHolder.birth ? 'foreign_process' : 'lock_held',
      reason: directory.reason ?? `runtime ロックを PID ${lockHolder.pid} が保持しています`,
    };
  }

  const targets = new Set(holdersOf(before).map((h) => h.pid));
  if (lockHolder) targets.add(lockHolder.pid);
  const candidates = before.processes.filter((p) => targets.has(p.pid));
  let after = before;
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
    const refusedAfter = refuseStrangers(after, provenPids(after));
    if (refusedAfter) return refusedAfter;
    const remaining = holdersOf(after);
    if (remaining.length > 0) {
      return {
        ok: false,
        cause: 'port_in_use',
        reason: `ポート ${[...new Set(remaining.map((h) => h.port))].join(',')} は停止後も PID ${remaining.map((h) => h.pid).join(',')} が使用中です`,
      };
    }
  }

  // A lock written by a launch of ours whose holder is gone is stale. Only a lock
  // that still names the recorded PID is removed (re-read just before unlinking).
  const removedLocks: string[] = [];
  for (const rec of lockRecords) {
    if (!rec.lockPath) continue;
    const alive = after.processes.find((p) => p.pid === rec.pid);
    if (alive && alive.birth === rec.birth) continue;
    if ((await deps.readLockPid(rec.lockPath)) !== rec.pid) continue;
    if (await deps.removeLock(rec.lockPath, rec.pid)) removedLocks.push(rec.lockPath);
  }
  const afterDirectory = await deps.inspectDirectory(workdir, after.processes);
  if (!afterDirectory.free) {
    return {
      ok: false,
      cause: 'lock_held',
      reason: afterDirectory.reason ?? 'runtime ディレクトリのロックが残っています',
    };
  }
  return { ok: true, stoppedPids: candidates.map((p) => p.pid), removedLocks };
}

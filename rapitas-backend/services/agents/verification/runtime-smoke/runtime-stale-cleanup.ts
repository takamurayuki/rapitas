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
 * equals the recorded one argument for argument — and it is not a protected
 * (port 3001) process, this process, an ancestor of it, or owned by another
 * active borrower. Descendants of a confirmed root require an observed record
 * before they become candidates. Every decision is made before the first signal:
 * if any holder of the fixed port or the lock is not proven, nothing is stopped.
 */
import {
  inspectRuntimeDirectory,
  readRuntimeLockPid,
  removeRuntimeLockIfOwnedBy,
  type RuntimeDirectoryOccupancy,
} from './runtime-directory-occupancy';
import { normalizeForMatch, sameArgv, tokenizeCommandLine } from './runtime-command-match';
import {
  readLaunchHistory,
  recordLaunchProcesses,
  type LaunchRecord,
} from './runtime-launch-history';
import {
  stopRuntimeProcesses,
  terminateRuntimeIdentities,
  type RuntimeStopDependencies,
} from './runtime-process-stop';
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
    historyPaths?: readonly string[],
  ): Promise<RuntimeDirectoryOccupancy>;
  readHistory(workdir: string): Promise<LaunchRecord[]>;
  recordProcesses(
    workdir: string,
    identities: RuntimeProcessIdentity[],
    role: 'observed',
  ): Promise<boolean>;
  readLockPid(path: string): Promise<number | null>;
  /** Removes the lock only while it still names `expectedPid`. */
  removeLock(path: string, expectedPid: number): Promise<boolean>;
  /** PIDs owned by other active registry entries; never stopped. */
  excludePids?: ReadonlySet<number>;
  /** Passed straight to stopRuntimeProcesses (tests inject a fake OS). */
  stopDeps?: RuntimeStopDependencies;
  stopTimeoutMs?: number;
}

type StaleCleanupFailure = { ok: false; cause: RuntimeEnvCause; reason: string };
export type StaleCleanupResult =
  | { ok: true; stoppedPids: number[]; removedLocks: string[] }
  | StaleCleanupFailure;

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
  recordProcesses: recordLaunchProcesses,
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
    /(?:^|\s)(?:--port|-p)(?:\s+|=)(\d{1,5})(?=\s|$)/g,
    /\bPORT=(\d{1,5})\b/g,
    /:(\d{1,5})(?=[/?#\s"'&;]|$)/g,
  ];
  for (const re of patterns) {
    for (const m of start.matchAll(re)) {
      const port = Number(m[1]);
      if (port > 0 && port < 65536) found.add(port);
    }
  }
  return [...found];
}

/** 設定URLの固定ポートを優先し、未指定なら起動コマンドから取得する。 */
export function extractFixedPorts(cfg: { url: string; start?: string }): number[] {
  const port = fixedPortOf(cfg.url);
  return port === null ? extractStartPorts(cfg.start ?? '') : [port];
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
  const ports = extractFixedPorts(cfg);
  if (ports.includes(BACKEND_PORT)) {
    return {
      ok: false,
      cause: 'port_in_use',
      reason: `ポート ${BACKEND_PORT} は rapitas バックエンドのため起動確認には使えません`,
    };
  }
  const normalizedWorkdir = normalizeForMatch(workdir);
  const readWorktreeHistory = async () =>
    (await deps.readHistory(workdir)).filter(
      (record) => normalizeForMatch(record.workdir) === normalizedWorkdir,
    );
  let history = await readWorktreeHistory().catch(() => []);
  let before: RuntimeProcessSnapshot;
  try {
    before = await deps.snapshot();
  } catch {
    // 初回の検査基盤障害だけは掃除を省略する。停止開始後の失敗は許可しない。
    return { ok: true, stoppedPids: [], removedLocks: [] };
  }

  const isBackendOwner = (snap: RuntimeProcessSnapshot, pid: number): boolean =>
    snap.protectedPids.has(pid) ||
    snap.listeners?.some((listener) => listener.port === BACKEND_PORT && listener.pid === pid) ===
      true;
  const isExcluded = (snap: RuntimeProcessSnapshot, pid: number): boolean =>
    isBackendOwner(snap, pid) ||
    pid === process.pid ||
    ancestorsOf(process.pid, snap.processes).has(pid) ||
    deps.excludePids?.has(pid) === true;
  const matchesRecord = (row: RuntimeProcessIdentity, rec: LaunchRecord): boolean =>
    rec.pid === row.pid &&
    rec.birth === row.birth &&
    sameArgv(rec.argv, tokenizeCommandLine(row.command));

  const matchingProcesses = (snap: RuntimeProcessSnapshot, records: LaunchRecord[]) =>
    snap.processes.filter((row) => records.some((rec) => matchesRecord(row, rec)));
  const liveRootTree = (snap: RuntimeProcessSnapshot, records: LaunchRecord[]) =>
    extendOwnedRuntimeTree(
      matchingProcesses(
        snap,
        records.filter((rec) => rec.role === 'root'),
      ),
      snap.processes,
    );
  const holdersOf = (snap: RuntimeProcessSnapshot) =>
    (snap.listeners ?? []).filter((l) => ports.includes(l.port));
  const hasProtectedHolder = (snap: RuntimeProcessSnapshot) =>
    holdersOf(snap).some((holder) => isBackendOwner(snap, holder.pid));
  const failure = (cause: RuntimeEnvCause, reason: string): StaleCleanupFailure => ({
    ok: false,
    cause,
    reason,
  });
  const unconfirmedFixedPorts = (snap: RuntimeProcessSnapshot) =>
    ports.length > 0 && !snap.listeners;

  if (unconfirmedFixedPorts(before))
    return failure('port_in_use', `ポート ${ports.join(',')} の使用状況を確認できません`);
  if (hasProtectedHolder(before))
    return failure('port_in_use', '固定ポートの所有者はバックエンドの保護対象です');

  const initialRecords = history.filter((rec) => rec.kind === 'process');
  const initiallyMatched = matchingProcesses(before, initialRecords);
  const discovered = liveRootTree(before, initialRecords).filter(
    (row) => !initiallyMatched.some((known) => known.pid === row.pid),
  );
  if (discovered.length > 0) {
    if (
      initiallyMatched.some((row) => isExcluded(before, row.pid)) ||
      discovered.some(
        (row) =>
          !tokenizeCommandLine(row.command)?.length ||
          isExcluded(before, row.pid) ||
          initialRecords.some((rec) => rec.pid === row.pid),
      )
    )
      return failure('foreign_process', '新たに観測した子孫の身元または保護状態を確認できません');
    try {
      if (!(await deps.recordProcesses(workdir, discovered, 'observed')))
        return failure('foreign_process', '子孫の起動履歴を保存できません');
      history = await readWorktreeHistory();
      before = await deps.snapshot();
    } catch (error) {
      return failure('foreign_process', `保存後の子孫の照合に失敗しました: ${String(error)}`);
    }
    const currentByPid = new Map(before.processes.map((row) => [row.pid, row]));
    const confirmed = (row: RuntimeProcessIdentity, requiredRole?: 'observed') => {
      const current = currentByPid.get(row.pid);
      return (
        current &&
        history.some(
          (rec) =>
            rec.kind === 'process' &&
            (requiredRole === undefined || rec.role === requiredRole) &&
            matchesRecord(row, rec) &&
            matchesRecord(current, rec),
        )
      );
    };
    if (
      discovered.some((row) => !confirmed(row, 'observed')) ||
      initiallyMatched.some((row) => currentByPid.has(row.pid) && !confirmed(row))
    )
      return failure('foreign_process', '観測した子孫の保存記録または現在の身元が一致しません');
    if (unconfirmedFixedPorts(before))
      return failure('foreign_process', '履歴保存後の固定ポートの使用状況を確認できません');
  }

  const processRecords = history.filter((rec) => rec.kind === 'process');
  const lockRecords = history.filter((rec) => rec.kind === 'lock');
  const candidates = matchingProcesses(before, processRecords);
  const proven = new Set(candidates.map((p) => p.pid));

  /** Why a holder is not provably ours. `foreign_process` = it conflicts with a record or cannot be identified. */
  const classifyStranger = (snap: RuntimeProcessSnapshot, pid: number): RuntimeEnvCause => {
    if (isBackendOwner(snap, pid)) return 'port_in_use';
    const row = snap.processes.find((p) => p.pid === pid);
    if (!row?.birth || !tokenizeCommandLine(row.command)?.length) return 'foreign_process';
    return processRecords.some((rec) => rec.pid === pid) ? 'foreign_process' : 'port_in_use';
  };
  const refuseStrangers = (
    snap: RuntimeProcessSnapshot,
    proven: Set<number>,
  ): StaleCleanupFailure | null => {
    const strangers = holdersOf(snap).filter((h) => !proven.has(h.pid));
    if (strangers.length === 0) return null;
    const causes = strangers.map((h) => classifyStranger(snap, h.pid));
    return {
      ok: false,
      cause: causes.includes('foreign_process') ? 'foreign_process' : 'port_in_use',
      reason: `ポート ${[...new Set(strangers.map((h) => h.port))].join(',')} は PID ${strangers.map((h) => h.pid).join(',')} が使用中です（この worktree の起動確認由来と履歴で証明できないため停止しません）`,
    };
  };

  // 既知ロックに加え、履歴に残ったworktree内のパスだけを照合する。
  const withinWorkdir = (path: string) => {
    const normalized = normalizeForMatch(path);
    return (
      normalized.startsWith(`${normalizeForMatch(workdir).replace(/\/$/, '')}/`) &&
      !normalized.split('/').includes('..')
    );
  };
  const historyPaths = lockRecords.flatMap((record) =>
    record.lockPath && withinWorkdir(record.lockPath) ? [record.lockPath] : [],
  );
  const directory = await deps.inspectDirectory(workdir, before.processes, historyPaths);
  const locks = [
    ...new Map(
      (directory.locks ?? (directory.path ? [directory] : [])).map((lock) => [
        normalizeForMatch(lock.path!),
        lock,
      ]),
    ).values(),
  ];
  if (!directory.free && !directory.path)
    return failure('lock_held', directory.reason ?? 'ロックの所有者を確認できません');
  for (const record of lockRecords) {
    if (
      !record.lockPath ||
      !withinWorkdir(record.lockPath) ||
      locks.some((lock) => normalizeForMatch(lock.path!) === normalizeForMatch(record.lockPath!))
    )
      continue;
    const pid = await deps.readLockPid(record.lockPath);
    if (pid !== null) locks.push({ path: record.lockPath, pid });
  }
  const removable: LaunchRecord[] = [];
  for (const lock of locks) {
    const record = lockRecords.find(
      (r) =>
        r.lockPath &&
        lock.path &&
        normalizeForMatch(r.lockPath) === normalizeForMatch(lock.path) &&
        r.pid === lock.pid,
    );
    if (!lock.path || !withinWorkdir(lock.path) || !record)
      return failure('lock_held', lock.reason ?? '履歴に記録のないロックが残っています');
    const owner = before.processes.find((p) => p.pid === lock.pid);
    if (owner && (owner.birth !== record.birth || !proven.has(owner.pid)))
      return failure('foreign_process', 'ロック所有者が起動履歴と一致しません');
    removable.push(record);
  }
  const refusedPort = refuseStrangers(before, proven);
  if (refusedPort) return refusedPort;
  if (hasProtectedHolder(before))
    return failure('port_in_use', '固定ポートの所有者はバックエンドの保護対象です');
  if (candidates.some((row) => isExcluded(before, row.pid)))
    return failure('foreign_process', '停止候補に保護対象または別の借り手が含まれています');
  // NOTE: A recorded PID now owned by an unrelated process means the recorded
  // process has exited; that record is stale. The reused process is never stopped
  // (it is not in `candidates`), and if it holds our port or lock it was already
  // refused above (refuseStrangers / the lock check). Failing the whole check here
  // kept the task's PR from ever being created (2026-11-27, task 1568).
  let after = before;
  if (candidates.length > 0) {
    let stopPortRefusal: StaleCleanupFailure | undefined;
    const source: RuntimeStopDependencies = deps.stopDeps ?? {
      snapshot: deps.snapshot,
      terminate: (identity) => terminateRuntimeIdentities([identity]),
      terminateMany: terminateRuntimeIdentities,
      wait: () => new Promise((resolve) => setTimeout(resolve, 250)),
      now: Date.now,
    };
    const checkedSnapshot = async (): Promise<RuntimeProcessSnapshot> => {
      const snap = await source.snapshot();
      if (unconfirmedFixedPorts(snap))
        throw new Error('停止直前に固定ポートの使用状況を確認できません');
      for (const target of candidates) {
        const row = snap.processes.find((p) => p.pid === target.pid);
        if (
          row &&
          (row.birth !== target.birth ||
            !sameArgv(tokenizeCommandLine(target.command), tokenizeCommandLine(row.command)) ||
            isExcluded(snap, row.pid))
        )
          throw new Error('停止直前にプロセス身元または保護状態が変化しました');
      }
      if (liveRootTree(snap, processRecords).some((row) => isExcluded(snap, row.pid)))
        throw new Error('停止直前のツリーに保護対象が含まれています');
      const refused = refuseStrangers(snap, proven);
      if (refused) {
        stopPortRefusal = refused;
        throw new Error(refused.reason);
      }
      // 停止層の子孫再展開にも、同じ許可集合を適用する。保護情報と待受は削らない。
      // argv の一致を確認済みの表記差は、停止層の生コマンド比較でも同じ身元に揃える。
      return {
        ...snap,
        processes: snap.processes.flatMap((row) => {
          const target = candidates.find((candidate) => candidate.pid === row.pid);
          return target ? [{ ...row, command: target.command }] : [];
        }),
      };
    };
    const guardedDeps: RuntimeStopDependencies = {
      ...source,
      snapshot: checkedSnapshot,
      terminate: async (identity) => {
        await checkedSnapshot();
        await source.terminate(identity);
      },
      terminateMany: source.terminateMany
        ? async (identities) => {
            await checkedSnapshot();
            await source.terminateMany!(identities);
          }
        : undefined,
    };
    const stop = await stopRuntimeProcesses(
      candidates,
      async () => {},
      deps.stopTimeoutMs ?? STOP_VERIFY_TIMEOUT_MS,
      guardedDeps,
    );
    if (!stop.stopped) {
      return (
        stopPortRefusal ??
        failure('foreign_process', `残存プロセスを停止できませんでした: ${stop.reason}`)
      );
    }
    try {
      after = await deps.snapshot();
    } catch {
      return failure('foreign_process', '停止後の死亡確認に失敗しました');
    }
    if (unconfirmedFixedPorts(after))
      return failure('foreign_process', '停止後の固定ポートの解放を確認できません');
    const stillProven = new Set(matchingProcesses(after, processRecords).map((row) => row.pid));
    const refusedAfter = refuseStrangers(after, stillProven);
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
  for (const rec of removable) {
    if (!rec.lockPath) continue;
    const alive = after.processes.find((p) => p.pid === rec.pid);
    if (alive) return failure('foreign_process', 'ロック所有者の死亡を確認できません');
    if ((await deps.readLockPid(rec.lockPath)) !== rec.pid)
      return failure('lock_held', '削除前にロックの内容が変化しました');
    if (!(await deps.removeLock(rec.lockPath, rec.pid)))
      return failure('lock_held', 'ロックの再確認付き削除に失敗しました');
    removedLocks.push(rec.lockPath);
  }
  const afterDirectory = await deps.inspectDirectory(workdir, after.processes, historyPaths);
  if (!afterDirectory.free || afterDirectory.path || afterDirectory.locks?.length) {
    return {
      ok: false,
      cause: 'lock_held',
      reason: afterDirectory.reason ?? 'runtime ディレクトリのロックが残っています',
    };
  }
  return { ok: true, stoppedPids: candidates.map((p) => p.pid), removedLocks };
}

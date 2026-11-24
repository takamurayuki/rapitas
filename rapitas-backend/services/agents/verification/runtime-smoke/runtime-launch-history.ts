/**
 * runtime-smoke/runtime-launch-history
 *
 * Durable record of the processes (and lock files) a runtime launch created for
 * a worktree, kept in `<worktree>/.agent-pids/runtime-launch-history.json`. It
 * is separate from the ownership registry on purpose: removing a registry entry
 * must not erase the proof that a leftover process was started by us. This is
 * the ONLY evidence stale cleanup may use to stop a process. Not responsible
 * for deciding what to stop.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { normalizeForMatch, tokenizeCommandLine } from './runtime-command-match';
import type { RuntimeProcessIdentity } from './runtime-process-identity';
import {
  readRuntimeProcessSnapshot,
  type RuntimeProcessSnapshot,
} from './runtime-process-snapshot';
import { createLogger } from '../../../../config/logger';

const log = createLogger('runtime-smoke:launch-history');

/** Newest records kept per worktree. */
export const MAX_HISTORY_PER_WORKDIR = 50;
/** Dead records older than this are dropped first when trimming. */
const DEAD_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LaunchRecord {
  /** `process:<pid>:<birth>` or `lock:<path>`; unique within the file. */
  key: string;
  kind: 'process' | 'lock';
  /** Normalized worktree path the record belongs to. */
  workdir: string;
  pid: number;
  birth: string;
  /** `root` = spawned by the launch itself; `observed` = a descendant/listener seen alive. */
  role: 'root' | 'observed' | 'lock';
  command: string;
  /** Arguments split at record time; null = unparsable, never matches. */
  argv: string[] | null;
  /** Lock file path (kind `lock` only). */
  lockPath?: string;
  /** 起動設定から得た固定ポート。停止候補を作る根拠には使用しない。 */
  fixedPorts?: number[];
  recordedAt: string;
}

export interface LaunchHistoryDependencies {
  read(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  snapshot(): Promise<RuntimeProcessSnapshot>;
  now(): number;
}

export interface LaunchHistoryOptions {
  fixedPorts?: number[];
  deps?: Partial<LaunchHistoryDependencies>;
}

const defaults: LaunchHistoryDependencies = {
  read: (path) => readFile(path, 'utf8'),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  write: (path, content) => writeFile(path, content, { flag: 'wx' }),
  rename,
  unlink,
  snapshot: readRuntimeProcessSnapshot,
  now: Date.now,
};

function isLaunchRecord(value: unknown): value is LaunchRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as LaunchRecord;
  return (
    typeof v.key === 'string' &&
    v.key.length > 0 &&
    (v.kind === 'process' || v.kind === 'lock') &&
    typeof v.workdir === 'string' &&
    Number.isInteger(v.pid) &&
    v.pid > 0 &&
    typeof v.birth === 'string' &&
    /^\d+$/.test(v.birth) &&
    ['root', 'observed', 'lock'].includes(v.role) &&
    (v.kind === 'lock' ? v.role === 'lock' : v.role !== 'lock') &&
    typeof v.command === 'string' &&
    (v.argv === null || (Array.isArray(v.argv) && v.argv.every((a) => typeof a === 'string'))) &&
    typeof v.recordedAt === 'string' &&
    Number.isFinite(Date.parse(v.recordedAt)) &&
    (v.fixedPorts === undefined ||
      (Array.isArray(v.fixedPorts) &&
        v.fixedPorts.every((port) => Number.isInteger(port) && port > 0 && port <= 65535))) &&
    (v.kind !== 'lock' || (typeof v.lockPath === 'string' && v.lockPath.length > 0))
  );
}

/**
 * File that holds a worktree's launch history.
 *
 * @param workdir - Worktree root / worktree ルート
 * @returns Absolute history path / 履歴ファイルのパス
 */
export function launchHistoryPath(workdir: string): string {
  return join(workdir, '.agent-pids', 'runtime-launch-history.json');
}

/** Per-file write chain: updates are applied in order, each as temp file + rename. */
const chains = new Map<string, Promise<unknown>>();

async function readAll(path: string, deps: LaunchHistoryDependencies): Promise<LaunchRecord[]> {
  let raw: string;
  try {
    raw = await deps.read(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isLaunchRecord)
  ) {
    throw new Error('Invalid runtime launch history');
  }
  return value.entries;
}

function updateAll(
  path: string,
  change: (entries: LaunchRecord[]) => Promise<LaunchRecord[]>,
  deps: LaunchHistoryDependencies,
): Promise<void> {
  const operation = (chains.get(path) ?? Promise.resolve()).then(async () => {
    // A corrupt file is replaced rather than extended: it carried no usable evidence.
    const current = await readAll(path, deps).catch(() => []);
    await deps.mkdir(dirname(path));
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await deps.write(temp, JSON.stringify({ version: 1, entries: await change(current) }));
      await deps.rename(temp, path);
    } finally {
      await deps.unlink(temp).catch(() => {});
    }
  });
  chains.set(
    path,
    operation.catch(() => {}),
  );
  return operation;
}

/**
 * Read a worktree's launch records. A missing, corrupt or unreadable file is
 * "no evidence": the result is empty and nothing may be stopped on its basis.
 *
 * @param workdir - Worktree root / worktree ルート
 * @returns Records belonging to this worktree / この worktree の記録
 */
export async function readLaunchHistory(
  workdir: string,
  dependencies: Partial<LaunchHistoryDependencies> = {},
): Promise<LaunchRecord[]> {
  try {
    const mine = normalizeForMatch(workdir);
    return (await readAll(launchHistoryPath(workdir), { ...defaults, ...dependencies })).filter(
      (r) => r.workdir === mine,
    );
  } catch (error) {
    log.warn({ err: error, workdir }, '[launch-history] unreadable — treated as no evidence');
    return [];
  }
}

async function trim(
  records: LaunchRecord[],
  deps: LaunchHistoryDependencies,
): Promise<LaunchRecord[]> {
  if (records.length <= MAX_HISTORY_PER_WORKDIR) return records;
  const old = records.filter((r) => deps.now() - Date.parse(r.recordedAt) > DEAD_RECORD_TTL_MS);
  if (old.length > 0) {
    try {
      const { processes } = await deps.snapshot();
      const dead = new Set(
        old
          .filter((r) => !processes.some((p) => p.pid === r.pid && p.birth === r.birth))
          .map((r) => r.key),
      );
      // 死亡済みの古い記録を優先し、残る記録は新しい順で50件まで保持する。
      records = [
        ...records.filter((r) => dead.has(r.key)),
        ...records.filter((r) => !dead.has(r.key)),
      ];
    } catch (error) {
      log.warn({ err: error }, '[launch-history] 死亡確認不可のため最新50件で制限');
    }
  }
  return records.slice(-MAX_HISTORY_PER_WORKDIR);
}

async function upsert(
  workdir: string,
  added: LaunchRecord[],
  deps: LaunchHistoryDependencies,
): Promise<boolean> {
  try {
    await updateAll(
      launchHistoryPath(workdir),
      async (entries) => {
        // A later `observed` sighting must not demote the spawned root of the same process.
        const roots = new Set(entries.filter((e) => e.role === 'root').map((e) => e.key));
        const fresh = added.filter((r) => !(r.role === 'observed' && roots.has(r.key)));
        const keys = new Set(fresh.map((r) => r.key));
        return trim([...entries.filter((e) => !keys.has(e.key)), ...fresh], deps);
      },
      deps,
    );
    return true;
  } catch (error) {
    // A lost record only means a later cleanup stops less — the safe direction.
    log.warn(
      { err: error, workdir },
      '[launch-history] write failed — leftovers will not be cleaned',
    );
    return false;
  }
}

/**
 * Record live processes this launch created or observed.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param identities - Processes with PID, birth and command / プロセス身元
 * @param role - `root` for the spawned process, `observed` for the rest / 役割
 * @returns False when the write failed / 書き込み成功か
 */
export function recordLaunchProcesses(
  workdir: string,
  identities: RuntimeProcessIdentity[],
  role: 'root' | 'observed',
  options: LaunchHistoryOptions = {},
): Promise<boolean> {
  const deps = { ...defaults, ...options.deps };
  const at = new Date(deps.now()).toISOString();
  return upsert(
    workdir,
    identities.map((p) => ({
      key: `process:${p.pid}:${p.birth}`,
      kind: 'process',
      workdir: normalizeForMatch(workdir),
      pid: p.pid,
      birth: p.birth,
      role,
      command: p.command,
      argv: tokenizeCommandLine(p.command),
      ...(options.fixedPorts ? { fixedPorts: [...new Set(options.fixedPorts)] } : {}),
      recordedAt: at,
    })),
    deps,
  );
}

/**
 * Record the process holding a runtime lock file, with the birth it had when
 * the lock was created (read right after readiness — the only point at which
 * the lock exists and its holder is known).
 *
 * @param workdir - Worktree root / worktree ルート
 * @param lock - Lock file path and its holder / ロックと持ち主
 * @returns False when the write failed / 書き込み成功か
 */
export function recordLaunchLock(
  workdir: string,
  lock: { path: string; pid: number; birth: string },
  options: LaunchHistoryOptions = {},
): Promise<boolean> {
  const deps = { ...defaults, ...options.deps };
  return upsert(
    workdir,
    [
      {
        key: `lock:${normalizeForMatch(lock.path)}`,
        kind: 'lock',
        workdir: normalizeForMatch(workdir),
        pid: lock.pid,
        birth: lock.birth,
        role: 'lock',
        command: '',
        argv: null,
        lockPath: lock.path,
        recordedAt: new Date(deps.now()).toISOString(),
      },
    ],
    deps,
  );
}

/**
 * Self-Verification Activity Store
 *
 * Records which self-verification runs are in flight as one small JSON file
 * per run, so any process sharing the backend cwd — the server that runs the
 * gate and the agent-worker whose CLI watchdog must not kill a waiting agent —
 * can ask "is self-verification running for this worktree?" synchronously.
 * Not responsible for running the gate or for deciding what to do with the
 * answer; the watchdogs and verification-job-runner own that.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../../config/logger';
import { isPidAlive as liveIsPidAlive } from '../../../utils/common/pid-alive';

const log = createLogger('services:workflow:self-verification-activity');

/**
 * How long a run may count as running. Same value and env var as
 * verification-job-store's STALE_RUNNING_MS, so the agent stops waiting at
 * the moment the GET endpoint starts answering `interrupted`.
 */
export const SELF_VERIFICATION_ACTIVE_LIMIT_MS =
  Number(process.env.RAPITAS_VERIFY_JOB_STALE_MS) || 30 * 60 * 1000;

/** How long a finished marker is kept so a waiting watchdog can still report the result. */
export const FINISHED_TTL_MS = 10 * 60 * 1000;

/** One self-verification run as stored on disk. */
export interface SelfVerificationActivity {
  runId: string;
  taskId: number;
  /** Normalized worktree path used for matching (see {@link normalizeWorktreeKey}). */
  worktreeKey: string;
  worktreePath: string;
  /** PID of the process running the gate; a dead owner means the run is gone. */
  ownerPid: number;
  startedAt: number;
  /** Last write time; re-checked before a delete so a fresh write is never removed. */
  updatedAt: number;
  state: 'running' | 'finished';
  finishedAt?: number;
  ok?: boolean;
  unverifiable?: boolean;
  passed?: number;
  failed?: number;
}

/** Identity of a run, shared by start and finish. */
export interface ActivityRunRef {
  runId: string;
  taskId: number;
  worktreePath: string;
}

/** Verdict written when a run ends. */
export interface ActivityOutcome {
  ok: boolean;
  unverifiable: boolean;
  passed: number;
  failed: number;
}

/** Injectable side effects of the store. */
export interface ActivityStoreDeps {
  dir?: string;
  now?: () => number;
  isPidAlive?: (pid: number) => boolean;
  ownerPid?: number;
  /** Test seam: runs between the stale check and the re-read before a delete. */
  beforeDelete?: (file: string) => void;
}

/** Read/write API over the marker directory. */
export interface ActivityStore {
  markStarted(ref: ActivityRunRef): void;
  markFinished(ref: ActivityRunRef & ActivityOutcome): void;
  /** Live and recently finished runs for a worktree; expired markers are removed. */
  listForWorktree(worktreePath: string): SelfVerificationActivity[];
  listForTask(taskId: number): SelfVerificationActivity[];
  isRunning(record: SelfVerificationActivity): boolean;
  isActiveForWorktree(worktreePath: string): boolean;
}

/**
 * Normalize a worktree path so `C:\X\` and `c:/x` match.
 *
 * @param p - Worktree path / worktreeのパス
 * @returns Forward slashes, lower case, no trailing slash / 正規化済みキー
 */
export function normalizeWorktreeKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/**
 * Directory holding the markers. Based on process.cwd() like `.agent-pids`,
 * because the agent-worker is spawned with the server's cwd.
 *
 * @returns Absolute marker directory / 目印ファイルの置き場所
 */
export function resolveActivityDir(): string {
  return (
    process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR || join(process.cwd(), '.self-verification-active')
  );
}

function fileNameFor(runId: string): string {
  return `${runId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
}

function parseRecord(raw: string): SelfVerificationActivity | null {
  try {
    const r = JSON.parse(raw) as Partial<SelfVerificationActivity>;
    if (typeof r.runId !== 'string' || typeof r.worktreeKey !== 'string') return null;
    if (typeof r.startedAt !== 'number' || (r.state !== 'running' && r.state !== 'finished'))
      return null;
    return r as SelfVerificationActivity;
  } catch {
    return null;
  }
}

/**
 * Create a store over a marker directory.
 *
 * @param deps - Directory, clock and liveness check / 置き場所・時計・生存確認
 * @returns The store / ストア
 */
export function createActivityStore(deps: ActivityStoreDeps = {}): ActivityStore {
  const dirOf = () => deps.dir ?? resolveActivityDir();
  const now = deps.now ?? Date.now;
  const pidAlive = deps.isPidAlive ?? liveIsPidAlive;
  const ownerPid = deps.ownerPid ?? process.pid;

  const isRunning = (r: SelfVerificationActivity): boolean =>
    r.state === 'running' &&
    now() - r.startedAt < SELF_VERIFICATION_ACTIVE_LIMIT_MS &&
    pidAlive(r.ownerPid);

  const isExpired = (r: SelfVerificationActivity): boolean =>
    r.state === 'running' ? !isRunning(r) : now() - (r.finishedAt ?? r.updatedAt) > FINISHED_TTL_MS;

  const removeIfUnchanged = (file: string, seen: SelfVerificationActivity) => {
    try {
      deps.beforeDelete?.(file);
      const again = parseRecord(readFileSync(file, 'utf8'));
      if (again && again.updatedAt !== seen.updatedAt) return;
      unlinkSync(file);
    } catch {
      // Already gone or unreadable — nothing to clean.
    }
  };

  const readAll = (): SelfVerificationActivity[] => {
    const dir = dirOf();
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    const out: SelfVerificationActivity[] = [];
    for (const name of names) {
      const file = join(dir, name);
      let rec: SelfVerificationActivity | null;
      try {
        rec = parseRecord(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      if (!rec) continue;
      if (isExpired(rec)) {
        removeIfUnchanged(file, rec);
        continue;
      }
      out.push(rec);
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
  };

  const readOne = (runId: string): SelfVerificationActivity | null => {
    try {
      return parseRecord(readFileSync(join(dirOf(), fileNameFor(runId)), 'utf8'));
    } catch {
      return null;
    }
  };

  return {
    markStarted(ref) {
      const dir = dirOf();
      const t = now();
      const rec: SelfVerificationActivity = {
        runId: ref.runId,
        taskId: ref.taskId,
        worktreeKey: normalizeWorktreeKey(ref.worktreePath),
        worktreePath: ref.worktreePath,
        ownerPid,
        startedAt: t,
        updatedAt: t,
        state: 'running',
      };
      try {
        mkdirSync(dir, { recursive: true });
        // Exclusive create: a duplicate POST for the same runId keeps the first marker.
        writeFileSync(join(dir, fileNameFor(ref.runId)), JSON.stringify(rec), { flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
        log.warn({ err, runId: ref.runId }, '[self-verification] could not write start marker');
      }
    },

    markFinished(ref) {
      const dir = dirOf();
      const t = now();
      const prev = readOne(ref.runId);
      const rec: SelfVerificationActivity = {
        runId: ref.runId,
        taskId: ref.taskId,
        worktreeKey: normalizeWorktreeKey(ref.worktreePath),
        worktreePath: ref.worktreePath,
        ownerPid,
        startedAt: prev?.startedAt ?? t,
        updatedAt: t,
        state: 'finished',
        finishedAt: t,
        ok: ref.ok,
        unverifiable: ref.unverifiable,
        passed: ref.passed,
        failed: ref.failed,
      };
      const target = join(dir, fileNameFor(ref.runId));
      const tmp = `${target}.${process.pid}.tmp`;
      try {
        mkdirSync(dir, { recursive: true });
        // tmp + rename so a reader never sees a half-written marker.
        writeFileSync(tmp, JSON.stringify(rec));
        renameSync(tmp, target);
      } catch (err) {
        log.warn({ err, runId: ref.runId }, '[self-verification] could not write finish marker');
        try {
          unlinkSync(tmp);
        } catch {
          // tmp was never created or already moved.
        }
      }
    },

    listForWorktree(worktreePath) {
      const key = normalizeWorktreeKey(worktreePath);
      if (!key) return [];
      return readAll().filter((r) => r.worktreeKey === key);
    },

    listForTask(taskId) {
      return readAll().filter((r) => r.taskId === taskId);
    },

    isRunning,

    isActiveForWorktree(worktreePath) {
      return this.listForWorktree(worktreePath).some(isRunning);
    },
  };
}

let defaultStore: ActivityStore | null = null;

/**
 * Process-wide store over {@link resolveActivityDir}.
 *
 * @returns The shared store / 共有ストア
 */
export function getActivityStore(): ActivityStore {
  defaultStore ??= createActivityStore();
  return defaultStore;
}

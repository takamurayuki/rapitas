/**
 * runtime-smoke/runtime-server-registry-types
 *
 * Shared state, types, and small pure helpers for the workdir-scoped runtime
 * server registry. Split out of worktree-server-registry.ts (COMPONENT
 * SPLITTING POLICY 500-line hard limit) so the state machine, persistence
 * layer, and public API can each stay under the limit while sharing the same
 * in-memory registry Map and entry shape.
 */
import { realpathSync } from 'fs';
import { join } from 'path';
import type { LaunchedApp } from './app-launcher';
import type { RuntimeConfig } from './runtime-config';
import type { RuntimeProcessIdentity } from './runtime-process-identity';

export const PERSIST_DIR = join(process.cwd(), '.agent-pids');
export const PERSIST_PATH = join(PERSIST_DIR, 'runtime-servers.json');

/** How long an owned, zero-lease server stays up before being stopped. */
export const IDLE_STOP_MS = 20_000;
/** Bound on waiting for a stop signal to actually take effect. */
export const STOP_VERIFY_TIMEOUT_MS = 20_000;
/** Default bound on waiting for another caller's start/stop/drain. */
export const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
/** Poll granularity while waiting for a state we don't hold a promise for. */
export const POLL_INTERVAL_MS = 250;
/**
 * How old an identity-less registry record must be before the port +
 * directory-lock proof is accepted as evidence that no server survives in
 * the same OS boot. A launch that slipped in right before the owning backend
 * died binds its port / writes its `.next/dev/lock` within seconds; past this
 * window such a survivor is caught by that proof, so withholding release any
 * longer only deadlocks the worktree until the OS reboots (task 970).
 */
export const UNKNOWN_START_GRACE_MS = 60_000;

export type RegistryState = 'starting' | 'active' | 'stopping' | 'quarantined';

export interface RegistryEntry {
  bootId?: string;
  key: string;
  workdir: string;
  state: RegistryState;
  configFingerprint: string;
  port?: number;
  baseUrl?: string;
  /** Undefined for entries recovered from a previous backend process. */
  app?: LaunchedApp;
  leases: Set<string>;
  generation: number;
  startPromise?: Promise<AcquireResult>;
  stopPromise?: Promise<void>;
  validationPromise?: Promise<void>;
  startCancelled?: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
  quarantineReason?: string;
  identities?: RuntimeProcessIdentity[];
  /** Last durable write behind this entry (epoch ms); gates isStaleUnknownStart for identity-less entries. */
  recordedAt?: number;
}

export interface AcquireSuccess {
  ok: true;
  baseUrl: string;
  port: number;
  /** Pass to releaseRuntimeServer() when done. Double-release is a no-op. */
  lease: string;
  logs: () => string[];
}
export interface AcquireFailure {
  ok: false;
  reason: string;
  logs: string[];
  exitCode: number | null;
  hasExited: boolean;
  /**
   * True when this failure is NOT evidence about the app under test — e.g. a
   * bounded wait for another caller timed out, or the workdir is quarantined
   * pending stop confirmation. Callers should hold completion rather than
   * treat it as a hard verification failure.
   */
  unverifiable?: boolean;
}
export type AcquireResult = AcquireSuccess | AcquireFailure;

export interface AcquireOptions {
  /** Log-correlation label only. */
  label?: string;
  /** Aborts an in-progress WAIT for another caller (not a spawn this call owns). */
  signal?: AbortSignal;
  /** Bound on waiting for another caller's occupancy to resolve. */
  waitTimeoutMs?: number;
}

/** Shared in-memory registry — a module-level singleton by design. */
export const registry = new Map<string, RegistryEntry>();
let generationCounter = 0;
export function nextGeneration(): number {
  return ++generationCounter;
}
export function resetGenerationCounter(): void {
  generationCounter = 0;
}

export function fingerprintConfig(cfg: RuntimeConfig): string {
  return `${cfg.start}\u0000${cfg.url}\u0000${cfg.healthPath}`;
}

/**
 * Normalize a workdir to a stable registry key: resolve symlinks/junctions to
 * their real target, and case-fold on win32 (NTFS paths are case-insensitive —
 * two differently-cased spellings of the same worktree must collide to one
 * entry, or the dedup this module exists for silently fails).
 *
 * @param workdir - Candidate worktree/working directory. / 対象ディレクトリ
 * @returns Normalized key, or null when the path cannot be resolved. / 正規化キー
 */
export function normalizeWorkdirKey(workdir: string): string | null {
  try {
    const real = realpathSync(workdir);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    return null;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Whether an identity-less record is old enough for the port + directory
 * proof to stand in for an owned-tree inspection.
 *
 * @param recordedAt - Last durable write time (ISO string or epoch ms). / 記録時刻
 * @returns True once UNKNOWN_START_GRACE_MS has elapsed; false for a missing
 *   or unparsable time (fail closed). / 猶予経過済みか
 */
export function isStaleUnknownStart(recordedAt: string | number | undefined): boolean {
  const at = typeof recordedAt === 'string' ? Date.parse(recordedAt) : recordedAt;
  return typeof at === 'number' && Number.isFinite(at) && Date.now() - at >= UNKNOWN_START_GRACE_MS;
}

export function failure(
  reason: string,
  opts: {
    unverifiable?: boolean;
    logs?: string[];
    exitCode?: number | null;
    hasExited?: boolean;
  } = {},
): AcquireFailure {
  return {
    ok: false,
    reason,
    logs: opts.logs ?? [],
    exitCode: opts.exitCode ?? null,
    hasExited: opts.hasExited ?? false,
    unverifiable: opts.unverifiable,
  };
}

export function cancelIdleTimer(entry: RegistryEntry): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

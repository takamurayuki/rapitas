/**
 * theme-auto-run-types
 *
 * Type definitions and the DB-row → ThemeAutoRunState mapper shared by
 * theme-auto-run-mutations.ts and theme-auto-run-queries.ts. Split out of
 * theme-auto-run-service.ts (task 784) to stay under the file-size ratchet;
 * theme-auto-run-service.ts re-exports this as a barrel.
 */
import { narrowEnum } from '../../../utils/common/type-guards';

/**
 * Runtime array of all valid auto-run status values. Derive AutoRunStatus from this
 * so the type and the runtime validation list can never drift apart.
 */
export const AUTO_RUN_STATUSES = ['idle', 'running', 'paused', 'stopping'] as const;

/** Valid status values for ThemeAutoRun.status. */
export type AutoRunStatus = (typeof AUTO_RUN_STATUSES)[number];

/**
 * Narrows a DB string (or null/undefined) to AutoRunStatus, returning 'idle' as
 * the safe fallback when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @returns A valid AutoRunStatus. / 有効なAutoRunStatus
 */
export function narrowAutoRunStatus(s: string | null | undefined): AutoRunStatus {
  return narrowEnum(s, AUTO_RUN_STATUSES, 'idle');
}

/** Serialisable view of a ThemeAutoRun record. */
export interface ThemeAutoRunState {
  id: number;
  themeId: number;
  enabled: boolean;
  status: AutoRunStatus;
  order: 'priority' | 'created';
  currentTaskId: number | null;
  processedCount: number;
  lastError: string | null;
  lastRunAt: string | null;
  startedAt: string | null;
  /** When the theme went idle with no work (idle-stop timer origin); null while running. */
  idleSince: string | null;
  /** Set when the idle-stop timer disabled auto-run; null after a USER stop or a start. */
  idleStoppedAt: string | null;
  /** When the nightly backlog self-refill last ran for this theme. */
  lastSelfRefillAt: string | null;
  updatedAt: string;
}

/**
 * Idle-timer columns (task 784), which the generated Prisma client only
 * knows after the next regeneration/restart. Read/write through a cast.
 */
export type IdleTimerColumns = {
  idleSince?: Date | null;
  idleStoppedAt?: Date | null;
  lastSelfRefillAt?: Date | null;
};

/**
 * Map a raw ThemeAutoRun DB row to its serialisable state. Idle-timer columns
 * are read by name via a cast: absent (pre-regeneration client) reads as null.
 * Shared by theme-auto-run-mutations.ts and theme-auto-run-queries.ts.
 *
 * @param r - Raw Prisma row. / 生のPrisma行
 * @returns Serialisable state. / シリアライズ可能な状態
 */
export function mapToState(r: {
  id: number;
  themeId: number;
  enabled: boolean;
  status: string;
  order: string;
  currentTaskId: number | null;
  processedCount: number;
  lastError: string | null;
  lastRunAt: Date | null;
  startedAt: Date | null;
  updatedAt: Date;
}): ThemeAutoRunState {
  const idle = r as IdleTimerColumns;
  return {
    id: r.id,
    themeId: r.themeId,
    enabled: r.enabled,
    status: narrowAutoRunStatus(r.status),
    order: r.order as 'priority' | 'created',
    currentTaskId: r.currentTaskId,
    processedCount: r.processedCount,
    lastError: r.lastError,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    idleSince: idle.idleSince?.toISOString() ?? null,
    idleStoppedAt: idle.idleStoppedAt?.toISOString() ?? null,
    lastSelfRefillAt: idle.lastSelfRefillAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

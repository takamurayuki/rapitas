/**
 * calendar-slots-handlers
 *
 * Request logic behind the calendar-slot dashboard API (task 1174): next run
 * schedule, execution log, sync state, and the calendar-only OAuth callback.
 * Kept free of Elysia and of a concrete Prisma client so it is unit-testable.
 * Not responsible for route wiring (calendar-slots.routes.ts) or the gate
 * decision (auto-run-advance-gates.ts).
 */
import { randomBytes } from 'crypto';
import {
  computeFreeSlots,
  computeNextRunAt,
  evaluateCalendarGate,
  isSyncStale,
} from '../../../services/scheduling/calendar-slot/free-slot';
import {
  getCalendarSlotSettings,
  getCalendarSnapshot,
  listCalendarHolds,
} from '../../../services/scheduling/calendar-slot/calendar-hold-state';
import type { CalendarTokenStore } from '../../../services/scheduling/calendar-slot/token-store';

const LOG_ACTION_PREFIX = 'calendar_slot.';
const OAUTH_STATE_TTL_MS = 10 * 60_000;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Next run schedule: next start time, current gate decision, free slots and
 * busy blocks (times only) within the fetched horizon, and held themes.
 *
 * @param now - Current time / 現在時刻
 * @returns Dashboard payload / ダッシュボード用データ
 */
export function buildNextRuns(now: Date) {
  const settings = getCalendarSlotSettings();
  const snap = getCalendarSnapshot();
  const usable =
    snap.lastStatus === 'ok' && !isSyncStale(snap.lastSyncedAt, now, settings.pollMinutes);
  const blocks = usable ? snap.busyBlocks : [];
  const gate = evaluateCalendarGate({
    now,
    busyBlocks: blocks,
    leadMinutes: settings.leadMinutes,
    enabled: settings.enabled && usable,
    overridden: false,
  });
  const horizon = snap.horizonEnd ?? new Date(now.getTime() + 86_400_000);
  return {
    enabled: settings.enabled,
    leadMinutes: settings.leadMinutes,
    nextRunAt: iso(
      computeNextRunAt({ now, busyBlocks: blocks, leadMinutes: settings.leadMinutes, horizon }),
    ),
    gate: { hold: gate.hold, reason: gate.reason, releaseAt: iso(gate.releaseAt) },
    freeSlots: computeFreeSlots(blocks, now, horizon, settings.leadMinutes).map((s) => ({
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
    })),
    busyBlocks: blocks
      .filter((b) => b.endAt.getTime() > now.getTime())
      .map((b) => ({ startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString() })),
    holds: listCalendarHolds()
      .filter((h) => h.releaseAt === null || h.releaseAt.getTime() > now.getTime())
      .map((h) => ({ themeId: h.themeId, releaseAt: iso(h.releaseAt) })),
  };
}

/**
 * Poller status for the dashboard.
 *
 * @param now - Current time / 現在時刻
 * @param connected - Whether a refresh token is stored / 連携済みか
 * @returns Sync status payload / 同期状態
 */
export function buildSyncState(now: Date, connected: boolean) {
  const settings = getCalendarSlotSettings();
  const snap = getCalendarSnapshot();
  return {
    enabled: settings.enabled,
    connected,
    pollMinutes: settings.pollMinutes,
    lastSyncedAt: iso(snap.lastSyncedAt),
    lastStatus: snap.lastStatus,
    lastError: snap.lastError,
    stale: isSyncStale(snap.lastSyncedAt, now, settings.pollMinutes),
  };
}

/** Minimal ActivityLog surface used by the log listing. */
export interface ActivityLogReader {
  findMany(
    args: unknown,
  ): Promise<Array<{ id: number; action: string; metadata: string | null; createdAt: Date }>>;
  count(args: unknown): Promise<number>;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Page through calendar_slot.* ActivityLog rows, newest first.
 *
 * @param reader - ActivityLog reader / ActivityLog 読み取り
 * @param page - 1-based page / ページ番号(1始まり)
 * @param limit - Rows per page / 1ページの件数
 * @returns Items and total count / 一覧と総件数
 */
export async function listSlotLogs(reader: ActivityLogReader, page: number, limit: number) {
  const take = Math.min(100, Math.max(1, Math.floor(limit) || 20));
  const skip = (Math.max(1, Math.floor(page) || 1) - 1) * take;
  const where = { action: { startsWith: LOG_ACTION_PREFIX } };
  const [rows, total] = await Promise.all([
    reader.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: { id: true, action: true, metadata: true, createdAt: true },
    }),
    reader.count({ where }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      metadata: parseMetadata(r.metadata),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// Pending CSRF states for the calendar OAuth flow (single-use, 10-minute TTL).
const oauthStates = new Map<string, number>();

/** @returns A fresh single-use OAuth state. / 使い捨ての OAuth state */
export function createOAuthState(): string {
  const now = Date.now();
  for (const [s, exp] of oauthStates) if (exp < now) oauthStates.delete(s);
  const state = randomBytes(24).toString('hex');
  oauthStates.set(state, now + OAUTH_STATE_TTL_MS);
  return state;
}

/** Reset pending OAuth states. Test-only — never call from production code. */
export function resetOAuthStates(): void {
  oauthStates.clear();
}

export type CalendarOAuthResult = 'connected' | 'invalid_state' | 'no_refresh_token' | 'error';

/**
 * Finish the calendar OAuth flow: verify state, exchange the code, store the
 * refresh token via the token store (never the DB), then sync once.
 *
 * @param params - code / state query values / コールバックのクエリ
 * @param deps - Token exchange, token store and sync trigger / 依存
 * @returns Outcome code / 結果コード
 */
export async function completeCalendarOAuth(
  params: { code?: string; state?: string },
  deps: {
    exchange: (code: string) => Promise<{ refresh_token?: string | null }>;
    tokenStore: CalendarTokenStore;
    triggerSync: () => Promise<void>;
  },
): Promise<CalendarOAuthResult> {
  const exp = params.state ? oauthStates.get(params.state) : undefined;
  if (!params.state || exp === undefined || exp < Date.now()) return 'invalid_state';
  oauthStates.delete(params.state);
  if (!params.code) return 'error';
  const tokens = await deps.exchange(params.code);
  if (!tokens.refresh_token) return 'no_refresh_token';
  deps.tokenStore.set(tokens.refresh_token);
  await deps.triggerSync();
  return 'connected';
}

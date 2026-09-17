/**
 * Supervision Handlers
 *
 * Request handlers for the supervision acceptance gate: read the persisted
 * verdict with its denominators, list interventions/gaps, and accept
 * interventions and heartbeats reported by external supervisors/monitors.
 * Not responsible for judging — see services/supervision.
 */
import { createLogger } from '../../../config/logger';
import {
  INTERVENTION_SOURCE_KINDS,
  emitHeartbeat,
  listInterventions,
  listObservationGaps,
  readAcceptanceStatus,
  readRecentHeartbeats,
  recordIntervention,
  type InterventionSourceKind,
} from '../../../services/supervision';

const log = createLogger('routes:supervision');

const DAY_MS = 24 * 3_600_000;
const MAX_DAYS = 90;

type Ctx = {
  query: Record<string, string | undefined>;
  body: unknown;
  set: { status?: number | string };
};

/** Resolves `?days=` into a window start, clamped to [1, 90]. */
function sinceFromQuery(query: Record<string, string | undefined>, defaultDays: number): Date {
  const parsed = query.days ? parseInt(query.days, 10) : defaultDays;
  const days = Number.isFinite(parsed) ? Math.min(MAX_DAYS, Math.max(1, parsed)) : defaultDays;
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * GET /agents/supervision/acceptance-status
 *
 * @param ctx - Elysia context / Elysiaコンテキスト
 * @returns Latest verdict with live heartbeat freshness / 最新判定と鮮度
 */
export async function handleGetAcceptanceStatus(ctx: Ctx) {
  try {
    const [status, heartbeats] = await Promise.all([
      readAcceptanceStatus(),
      readRecentHeartbeats(undefined, 1),
    ]);
    const last = heartbeats.samples[0]?.createdAt ?? null;
    return {
      success: true,
      ...status,
      heartbeatCount:
        typeof status.denominators.heartbeatCount === 'number'
          ? status.denominators.heartbeatCount
          : 0,
      lastHeartbeatAt: last?.toISOString() ?? null,
      heartbeatAgeSeconds: last ? Math.round((Date.now() - last.getTime()) / 1000) : null,
    };
  } catch (err) {
    log.error({ err }, '[supervision] failed to read acceptance status');
    ctx.set.status = 500;
    // Unobservable is reported as unmet, never as a missing field the UI could read as success.
    return {
      success: false,
      met: false,
      reasonCodes: ['no_observation_evidence'],
      error: 'failed to read status',
    };
  }
}

/**
 * GET /agents/supervision/interventions
 *
 * @param ctx - Elysia context / Elysiaコンテキスト
 * @returns Interventions in the window / 期間内の介入
 */
export async function handleListInterventions(ctx: Ctx) {
  try {
    return { success: true, interventions: await listInterventions(sinceFromQuery(ctx.query, 30)) };
  } catch (err) {
    log.error({ err }, '[supervision] failed to list interventions');
    ctx.set.status = 500;
    return { success: false, error: 'failed to list interventions' };
  }
}

/**
 * GET /agents/supervision/gaps
 *
 * @param ctx - Elysia context / Elysiaコンテキスト
 * @returns Observation gaps with stop reason and recovery time / 欠落区間
 */
export async function handleListGaps(ctx: Ctx) {
  try {
    return { success: true, gaps: await listObservationGaps(sinceFromQuery(ctx.query, 7)) };
  } catch (err) {
    log.error({ err }, '[supervision] failed to list gaps');
    ctx.set.status = 500;
    return { success: false, error: 'failed to list gaps' };
  }
}

/**
 * POST /agents/supervision/interventions — lets a human/Codex supervisor record
 * an intervention the transition table cannot see (e.g. a direct commit).
 *
 * @param ctx - Elysia context / Elysiaコンテキスト
 * @returns Whether it was persisted (spooled otherwise) / 永続化結果
 */
export async function handleRecordIntervention(ctx: Ctx) {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const sourceKind = body.sourceKind as InterventionSourceKind;
  if (
    !INTERVENTION_SOURCE_KINDS.includes(sourceKind) ||
    typeof body.note !== 'string' ||
    !body.note.trim()
  ) {
    ctx.set.status = 400;
    return { success: false, error: 'sourceKind and note are required' };
  }
  const taskId =
    typeof body.taskId === 'number' && Number.isInteger(body.taskId) ? body.taskId : null;
  const persisted = await recordIntervention({ taskId, sourceKind, note: body.note.trim() });
  if (!persisted) ctx.set.status = 503;
  return { success: persisted, persisted, spooled: !persisted };
}

/**
 * POST /agents/supervision/heartbeat — liveness sample from an external monitor.
 *
 * @param ctx - Elysia context / Elysiaコンテキスト
 * @returns Whether the sample was persisted / 永続化結果
 */
export async function handleExternalHeartbeat(ctx: Ctx) {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const monitorId = typeof body.monitorId === 'string' ? body.monitorId.trim() : '';
  const intervalMs = typeof body.intervalMs === 'number' ? body.intervalMs : NaN;
  // The backend's own id is reserved so an external sample cannot mask a backend gap.
  if (!/^[a-z0-9_-]{1,64}$/i.test(monitorId) || monitorId === 'backend' || !(intervalMs > 0)) {
    ctx.set.status = 400;
    return {
      success: false,
      error: 'monitorId (not "backend") and positive intervalMs are required',
    };
  }
  const pid = typeof body.pid === 'number' ? body.pid : null;
  const persisted = await emitHeartbeat(intervalMs, monitorId, {
    sourceKind: 'external_monitor',
    pid,
  });
  if (!persisted) ctx.set.status = 503;
  return { success: persisted };
}

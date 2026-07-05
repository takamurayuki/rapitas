/**
 * outcome-reinforcement
 *
 * Closes the "forgetting makes you smarter" loop: knowledge entries injected
 * into a task's context are reinforced when that task SUCCEEDS and decayed when
 * it FAILS — so what survives the forgetting curve is what actually HELPED, not
 * merely what was recent or popular.
 *
 * The retrieval→outcome link is held in a fast in-memory trace PLUS a durable
 * timeline event (`memory_retrieval`). The in-memory map alone leaked the
 * central learning signal: a backend restart, or the hours-long gap between
 * retrieval and outcome under staged completion (completion deferred to
 * CI-green/merge), silently dropped the reward/penalty. On outcome the two
 * sources are merged and the durable events are consumed (deleted) so a
 * duplicate outcome never double-applies.
 * This module owns the trace ONLY; the actual decay math lives in forgetting.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { boostDecayOnAccess, penalizeOnFailure } from './forgetting';
import { appendEvent, queryEvents } from './timeline';

const log = createLogger('memory:outcome-reinforcement');

/** Strong reward applied to entries that preceded a successful outcome. */
const SUCCESS_BOOST = Math.max(0, parseFloat(process.env.RAPITAS_KB_SUCCESS_BOOST ?? '0.3') || 0.3);
/** Decay applied to entries that preceded a failed/blocked outcome. */
const FAILURE_PENALTY = Math.max(
  0,
  parseFloat(process.env.RAPITAS_KB_FAILURE_PENALTY ?? '0.15') || 0.15,
);
/** Drop traces older than this (the task never reached a terminal outcome). */
const TRACE_TTL_MS = 3 * 60 * 60 * 1000; // 3h
/** Hard cap on concurrently-tracked tasks (backstop against a leak). */
const MAX_TRACES = 1000;

interface RetrievalTrace {
  entryIds: Set<number>;
  at: number;
}

const traces = new Map<number, RetrievalTrace>();

/** Drop traces past their TTL so a task that never finished can't leak memory. */
function pruneExpired(now: number): void {
  for (const [taskId, trace] of traces) {
    if (now - trace.at > TRACE_TTL_MS) traces.delete(taskId);
  }
  // Backstop: if still over the cap, evict the oldest.
  if (traces.size > MAX_TRACES) {
    // in-memory LRU eviction bookkeeping (evict oldest traces over the cap) —
    // never feeds a prompt or an execution-selection decision.
    // determinism-ok: in-memory eviction bookkeeping, not prompt-visible.
    const oldest = [...traces.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < traces.size - MAX_TRACES; i++) traces.delete(oldest[i][0]);
  }
}

/**
 * Record that `entryIds` were injected into `taskId`'s context. Merges across
 * multiple retrievals within the same task run (research + implement + verify).
 *
 * @param taskId - The task the knowledge was retrieved for. / 取得先タスクID
 * @param entryIds - Knowledge entry ids injected into context. / 注入したナレッジID
 */
export function recordRetrieval(taskId: number, entryIds: number[]): void {
  if (!Number.isInteger(taskId) || entryIds.length === 0) return;
  const now = Date.now();
  pruneExpired(now);
  const existing = traces.get(taskId);
  if (existing) {
    for (const id of entryIds) existing.entryIds.add(id);
    existing.at = now;
  } else {
    traces.set(taskId, { entryIds: new Set(entryIds), at: now });
  }

  // Durable copy: survives restarts and the multi-hour retrieval→outcome gap
  // under staged completion. Fire-and-forget — a DB hiccup must never block
  // the retrieval path (the in-memory trace still covers the common case).
  appendEvent({
    eventType: 'memory_retrieval',
    actorType: 'system',
    payload: { taskId, entryIds },
    correlationId: `task_${taskId}`,
  }).catch((err) => log.debug({ err, taskId }, '[kb-reinforce] durable trace write failed'));
}

/**
 * Load and CONSUME the durable retrieval trace for a task: reads all
 * `memory_retrieval` timeline events for `task_<taskId>` and deletes them so a
 * duplicate outcome (blocked → retried → completed) never double-applies.
 *
 * @param taskId - Task whose durable trace to consume. / 対象タスクID
 * @returns Entry ids recorded durably (empty on none/failure). / 記録済みID
 */
async function consumeDurableTrace(taskId: number): Promise<number[]> {
  try {
    const { events } = await queryEvents({
      eventType: 'memory_retrieval',
      correlationId: `task_${taskId}`,
      limit: 50,
    });
    if (events.length === 0) return [];
    const ids = new Set<number>();
    for (const e of events) {
      const payload = e.payload as { entryIds?: unknown };
      if (Array.isArray(payload.entryIds)) {
        for (const id of payload.entryIds) if (Number.isInteger(id)) ids.add(id as number);
      }
    }
    await prisma.timelineEvent.deleteMany({
      where: { eventType: 'memory_retrieval', correlationId: `task_${taskId}` },
    });
    return [...ids];
  } catch (err) {
    log.warn({ err, taskId }, '[kb-reinforce] durable trace read failed');
    return [];
  }
}

/**
 * Apply outcome-gated reinforcement for a finished task: boost the entries it
 * used on SUCCESS, decay them on failure, then clear both the in-memory and
 * durable traces. Best-effort — no trace anywhere is a no-op.
 *
 * @param taskId - The task that just reached a terminal outcome. / 終了タスクID
 * @param success - Whether the task completed successfully. / 成功したか
 * @returns Count of entries reinforced/penalized (0 when no trace). / 反映件数
 */
export async function applyOutcomeReinforcement(taskId: number, success: boolean): Promise<number> {
  const trace = traces.get(taskId);
  traces.delete(taskId);

  // Merge the fast in-memory trace with the durable timeline copy — either may
  // be missing (restart drops the map; a DB hiccup drops the events), and the
  // union double-counts nothing because it is a Set.
  const merged = new Set<number>(trace?.entryIds ?? []);
  for (const id of await consumeDurableTrace(taskId)) merged.add(id);
  if (merged.size === 0) return 0;

  const ids = [...merged];
  for (const id of ids) {
    try {
      if (success) await boostDecayOnAccess(id, SUCCESS_BOOST);
      else await penalizeOnFailure(id, FAILURE_PENALTY);
    } catch (err) {
      log.warn({ err, taskId, entryId: id }, '[kb-reinforce] Failed to apply outcome to entry');
    }
  }
  log.info(
    { taskId, success, entries: ids.length },
    `[kb-reinforce] ${success ? 'Reinforced' : 'Penalized'} ${ids.length} knowledge entr${ids.length === 1 ? 'y' : 'ies'} from task outcome`,
  );
  return ids.length;
}

/** Test-only: clear all traces. */
export function _resetTraces(): void {
  traces.clear();
}

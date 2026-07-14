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

/** Parsed usage declaration from the agent's output md (R8). */
export interface KnowledgeUsageDeclaration {
  /** True when a `## 使用知識` section was found (agent complied). */
  declared: boolean;
  /** Entry ids the agent says it actually used. */
  used: number[];
  /** Entry ids the agent flagged as WRONG / contradicting reality. */
  wrong: number[];
}

/**
 * Parse the agent's usage declaration (`## 使用知識` section with `- K-<id>`
 * lines; `誤り`/`wrong` marks a bad entry) out of an output md. Pure and
 * unit-testable. Returns declared:false when the section is absent — callers
 * then fall back to set-level (legacy) reinforcement.
 *
 * @param md - The saved artifact body (verify.md etc.). / 保存された成果物
 * @returns Parsed declaration. / 使用申告
 */
export function parseKnowledgeUsage(md: string | null | undefined): KnowledgeUsageDeclaration {
  const none: KnowledgeUsageDeclaration = { declared: false, used: [], wrong: [] };
  if (!md) return none;
  const m = md.match(/^#{2,3}\s*(?:使用知識|Knowledge Used)\s*$/im);
  if (!m || m.index === undefined) return none;
  // Section body: from the heading to the next heading of the same-or-higher level.
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^#{1,3}\s/m);
  const body = next === -1 ? rest : rest.slice(0, next);

  const used = new Set<number>();
  const wrong = new Set<number>();
  for (const line of body.split(/\r?\n/)) {
    const idMatch = line.match(/K[-–]?(\d+)/i);
    if (!idMatch) continue;
    const id = parseInt(idMatch[1]!, 10);
    if (!Number.isInteger(id)) continue;
    if (/誤り|間違|矛盾|wrong|incorrect|outdated/i.test(line)) wrong.add(id);
    else used.add(id);
  }
  return { declared: true, used: [...used], wrong: [...wrong] };
}

/** Extra penalty multiplier for entries the agent flagged as wrong. */
const WRONG_FLAG_MULTIPLIER = 2;

/** Usage-validated graduation: pending entry proven useful → validated / proven wrong → rejected. */
async function setValidationIfPending(
  entryId: number,
  to: 'validated' | 'rejected',
): Promise<void> {
  await prisma.knowledgeEntry
    .updateMany({
      where: { id: entryId, validationStatus: 'pending' },
      data: { validationStatus: to },
    })
    .catch(() => {});
}

/**
 * Apply outcome-gated reinforcement for a finished task, then clear both the
 * in-memory and durable traces. Best-effort — no trace anywhere is a no-op.
 *
 * With a usage declaration (R8 — the agent listed which injected entries it
 * ACTUALLY used), credit is assigned per entry instead of per set:
 *  - flagged wrong → strong penalty (regardless of outcome) + pending→rejected
 *  - declared used → boost on success (+ pending→validated) / decay on failure
 *  - injected but NOT declared → no reinforcement (it demonstrably didn't matter)
 * Without a declaration, the legacy uniform set-level behavior applies.
 * Declared ids are intersected with the actual injection trace so an agent
 * cannot boost arbitrary entries it was never shown.
 *
 * @param taskId - The task that just reached a terminal outcome. / 終了タスクID
 * @param success - Whether the task completed successfully. / 成功したか
 * @param usage - Parsed usage declaration (optional). / 使用申告
 * @returns Count of entries reinforced/penalized (0 when no trace). / 反映件数
 */
export async function applyOutcomeReinforcement(
  taskId: number,
  success: boolean,
  usage?: KnowledgeUsageDeclaration,
): Promise<number> {
  const trace = traces.get(taskId);
  traces.delete(taskId);

  // Merge the fast in-memory trace with the durable timeline copy — either may
  // be missing (restart drops the map; a DB hiccup drops the events), and the
  // union double-counts nothing because it is a Set.
  const merged = new Set<number>(trace?.entryIds ?? []);
  for (const id of await consumeDurableTrace(taskId)) merged.add(id);
  if (merged.size === 0) return 0;

  const fineGrained = usage?.declared === true;
  const usedSet = new Set(usage?.used ?? []);
  const wrongSet = new Set(usage?.wrong ?? []);

  // `applied` counts entries a reinforcement DECISION was made for — a failing
  // decay write is logged but still counted, matching the legacy contract
  // (return = targeted entries, not successful DB ops).
  let applied = 0;
  for (const id of merged) {
    try {
      if (fineGrained) {
        if (wrongSet.has(id)) {
          applied += 1;
          await penalizeOnFailure(id, FAILURE_PENALTY * WRONG_FLAG_MULTIPLIER);
          await setValidationIfPending(id, 'rejected');
        } else if (usedSet.has(id)) {
          applied += 1;
          if (success) {
            await boostDecayOnAccess(id, SUCCESS_BOOST);
            // The lesson was injected, used, and the task succeeded — that IS
            // the validation signal (a Reflexion lesson graduates here, not at
            // an unverified save).
            await setValidationIfPending(id, 'validated');
          } else {
            await penalizeOnFailure(id, FAILURE_PENALTY);
          }
        }
        // injected-but-undeclared: neutral — neither reward nor punish.
      } else {
        applied += 1;
        if (success) await boostDecayOnAccess(id, SUCCESS_BOOST);
        else await penalizeOnFailure(id, FAILURE_PENALTY);
      }
    } catch (err) {
      log.warn({ err, taskId, entryId: id }, '[kb-reinforce] Failed to apply outcome to entry');
    }
  }
  log.info(
    {
      taskId,
      success,
      injected: merged.size,
      applied,
      fineGrained,
      used: fineGrained ? usedSet.size : undefined,
      wrong: fineGrained ? wrongSet.size : undefined,
    },
    `[kb-reinforce] ${success ? 'Reinforced' : 'Penalized'} ${applied}/${merged.size} knowledge entries from task outcome${fineGrained ? ' (per-entry declaration)' : ''}`,
  );
  return applied;
}

/** Test-only: clear all traces. */
export function _resetTraces(): void {
  traces.clear();
}

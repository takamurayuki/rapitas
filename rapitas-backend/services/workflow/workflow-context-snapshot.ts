/**
 * Workflow Context Snapshot
 *
 * Freezes the retrieved half of a task's context for the life of that task.
 *
 * The researcher, planner, implementer and verifier each build their prompt
 * partly from retrieval: hybrid recall over the knowledge base, a
 * nearest-case lookup, mined lessons, a rolling fourteen-day window of
 * episodes. All of that moves on its own — a task completing elsewhere
 * reweights it, a new entry outranks an old one, the window slides. So the
 * same task asked twice is not asked the same question twice, and a repair
 * loop compares a run against a predecessor that saw something else.
 *
 * Measured 2026-10-21 before this existed: the retrieved block is ~4,000
 * estimated tokens in every role (62.2% of the researcher's whole prompt),
 * 48 tasks had entered the repair loop, and 75.4% of verify disputes could
 * not be attributed to any acceptance criterion. Holding retrieval still
 * does not fix a bad retrieval — it makes the loop compare like with like,
 * which is what has to be true before any of the rest can be measured.
 *
 * Stored as timeline events rather than a new table: the content is already
 * reconstructible, this needs no schema change (and so no restart), and it
 * stays readable through the timeline API that the audit used.
 *
 * Fails open everywhere. A snapshot that cannot be read or written must
 * never stop a phase from running — the worst case is the behaviour that
 * existed before this module.
 *
 * Not responsible for what is retrieved — see workflow-memory-context.ts and
 * its siblings.
 */
import { createLogger } from '../../config/logger';
import { appendEvent, queryEvents } from '../memory/timeline';

const log = createLogger('workflow:context-snapshot');

/** Timeline event type holding one frozen section. */
const EVENT_TYPE = 'context_snapshot';

/**
 * How long a snapshot stays usable.
 *
 * Longer than a task normally takes, shorter than "stale". A task still
 * running a day later has usually been through something — a block, a human
 * edit, a replan — and deserves to see what the knowledge base knows now.
 */
export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/** Most snapshots one task may hold, matching the retrieved section count. */
const MAX_PER_TASK = 12;

/**
 * How long one task's snapshot set is reused without re-reading.
 *
 * A phase builds four retrieved sections, and without this each one would
 * be its own round-trip to the timeline. Short enough that the next phase
 * re-reads, long enough to cover one context build.
 */
const READ_CACHE_MS = 30_000;

/**
 * Longest a snapshot read may delay a phase.
 *
 * Beyond this the phase retrieves afresh. Freezing context is worth having;
 * it is not worth making a run wait on a slow store, and the fallback is
 * exactly the behaviour that existed before this module.
 */
const READ_TIMEOUT_MS = 1_500;

/**
 * Whether freezing is on.
 *
 * `RAPITAS_CONTEXT_SNAPSHOT=off` restores the previous behaviour — every
 * phase retrieves afresh — so the two can be compared without a deploy.
 *
 * @param env - Raw env value / 環境変数値
 * @returns True when snapshots are used / スナップショットを使うか
 */
export function snapshotEnabled(
  env: string | undefined = process.env.RAPITAS_CONTEXT_SNAPSHOT,
): boolean {
  const value = env?.trim().toLowerCase();
  return !(value === 'off' || value === '0' || value === 'false' || value === 'no');
}

const correlation = (taskId: number) => `task_${taskId}`;

/** One task's snapshots, as last read, with when they were read. */
const readCache = new Map<number, { at: number; snapshots: Map<string, StoredSnapshot> }>();

/** A stored snapshot, as it comes back off the timeline. */
interface StoredSnapshot {
  section: string;
  content: string;
  at: number;
}

/**
 * Read back every snapshot this task holds.
 *
 * @param taskId - Task whose snapshots to read / 対象タスク
 * @returns Section name to stored text / セクション名→保存済みテキスト
 */
async function readSnapshots(taskId: number): Promise<Map<string, StoredSnapshot>> {
  const cached = readCache.get(taskId);
  if (cached && Date.now() - cached.at < READ_CACHE_MS) return cached.snapshots;

  const found = new Map<string, StoredSnapshot>();
  try {
    const { events } = await Promise.race([
      queryEvents({
        eventType: EVENT_TYPE,
        correlationId: correlation(taskId),
        limit: MAX_PER_TASK * 4,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('snapshot read timed out')), READ_TIMEOUT_MS),
      ),
    ]);
    for (const event of events) {
      const payload = (
        typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
      ) as { section?: string; content?: string };
      if (typeof payload?.section !== 'string' || typeof payload?.content !== 'string') continue;
      const at = new Date(event.createdAt).getTime();
      const existing = found.get(payload.section);
      // Oldest wins: the first phase's view is the one the rest should see.
      if (!existing || at < existing.at) {
        found.set(payload.section, { section: payload.section, content: payload.content, at });
      }
    }
  } catch (err) {
    log.debug({ err, taskId }, 'snapshot read failed — falling back to fresh retrieval');
    // Not cached: a failed read must not pin "there is nothing" for 30s.
    return found;
  }
  readCache.set(taskId, { at: Date.now(), snapshots: found });
  return found;
}

/**
 * Return this task's frozen copy of a section, or compute and freeze it.
 *
 * @param taskId - The task the section belongs to / 対象タスク
 * @param section - Section name, as the context metrics record it / セクション名
 * @param compute - Builds the section when there is nothing frozen yet / 未保存時の生成
 * @returns The section text / セクションの文字列
 */
export async function snapshotSection(
  taskId: number,
  section: string,
  compute: () => Promise<string>,
): Promise<string> {
  if (!snapshotEnabled() || !Number.isInteger(taskId) || taskId <= 0) return compute();

  const stored = (await readSnapshots(taskId)).get(section);
  if (stored && Date.now() - stored.at < SNAPSHOT_TTL_MS) return stored.content;

  const fresh = await compute();
  // Nothing retrieved is not worth freezing: storing an empty section would
  // pin "we found nothing" for a whole day over a knowledge base that may
  // have learned something an hour later.
  if (!fresh) return fresh;

  try {
    await appendEvent({
      eventType: EVENT_TYPE,
      actorType: 'system',
      payload: { taskId, section, content: fresh },
      correlationId: correlation(taskId),
    });
    // Visible to the rest of this context build without another read.
    const cached = readCache.get(taskId);
    if (cached) cached.snapshots.set(section, { section, content: fresh, at: Date.now() });
  } catch (err) {
    log.debug({ err, taskId, section }, 'snapshot write failed — the phase still has its context');
  }
  return fresh;
}

/**
 * Drop a task's frozen context so the next phase retrieves afresh.
 *
 * Called when a task is deliberately restarted: a retry is a decision that
 * the previous attempt's view of the world was not good enough, which
 * includes what it was told.
 *
 * @param taskId - Task to unfreeze / 対象タスク
 * @returns How many snapshots were dropped / 削除した件数
 */
export async function invalidateContextSnapshots(taskId: number): Promise<number> {
  try {
    readCache.delete(taskId);
    const { deleteEvents } = await import('../memory/timeline');
    return await deleteEvents({ eventType: EVENT_TYPE, correlationId: correlation(taskId) });
  } catch (err) {
    log.debug({ err, taskId }, 'snapshot invalidation failed — stale context may persist');
    return 0;
  }
}

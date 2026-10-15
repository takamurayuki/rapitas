/**
 * decision-ledger/settle-knowledge
 *
 * Settles the decision to recall knowledge into a task's context. The
 * `knowledge_effectiveness` events have been emitted for a long time without
 * driving anything; this turns the same evidence into a verdict that selection
 * can eventually act on.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { kindFromNodeKey } from '../observability/decision-trace/node-key';

const log = createLogger('decision-ledger:settle-knowledge');

/** Task statuses at which a recall can be judged at all. */
const TERMINAL = new Set(['done', 'blocked', 'cancelled']);

/** One recall's verdict and why. */
interface RecallVerdict {
  consistency: 'consistent' | 'inconsistent' | 'skipped';
  note: string;
}

/**
 * Judge one recall.
 *
 * A recall that returned nothing is `inconsistent`, not unjudgeable: it is a
 * measurable failure OF THE RECALL — the query found nothing to supply — and
 * folding it into "cannot judge" is what let an 86% miss rate stay invisible.
 *
 * A task that merely succeeded does NOT make the recall correct. Success while
 * knowledge happened to be in context is a correlation, and counting it as a
 * verdict would manufacture evidence for the very thing being tested. Only a
 * declared use counts; without a declaration the recall stays unjudged.
 */
export function judgeRecall(
  injected: number,
  entryIds: number[],
  usage: { declared: boolean; used: number[] } | null,
): RecallVerdict {
  if (injected === 0) {
    return {
      consistency: 'inconsistent',
      note: '想起が空振り: 該当する知識が無く何も供給しなかった',
    };
  }
  if (!usage?.declared) {
    return { consistency: 'skipped', note: '使用宣言が無く、役に立ったか判定できない' };
  }
  const usedHere = usage.used.filter((id) => entryIds.includes(id));
  return usedHere.length > 0
    ? {
        consistency: 'consistent',
        note: `注入した知識のうち ${usedHere.length} 件が実際に使われた`,
      }
    : { consistency: 'inconsistent', note: '注入したが1件も使われなかった' };
}

/** `ActivityLog.action` carrying one entry's usefulness on one recall. */
export const ENTRY_USAGE_ACTION = 'knowledge_entry_usage';

/**
 * Record, per injected entry, whether the agent declared using it.
 *
 * Stored as activity rows rather than a new column: this is the outcome half of
 * a decision already on record, and a fourth table would only add something
 * else to keep in sync. Fail-open — settlement must not break on bookkeeping.
 *
 * @param taskId - Task the recall served. / 想起先タスク
 * @param injected - Entry ids put into context. / 注入した知識ID
 * @param used - Entry ids the agent declared using. / 使用宣言された知識ID
 */
async function recordEntryUsage(taskId: number, injected: number[], used: number[]): Promise<void> {
  try {
    const usedSet = new Set(used);
    await prisma.activityLog.createMany({
      data: injected.map((entryId) => ({
        taskId,
        action: ENTRY_USAGE_ACTION,
        metadata: JSON.stringify({ entryId, used: usedSet.has(entryId) }),
      })),
    });
  } catch (err) {
    log.warn({ err, taskId }, '[decision-ledger] entry usage not recorded (non-fatal)');
  }
}

/** Read the injected count and entry ids back out of a recorded recall. */
function readRecall(inputMasked: string | null): { injected: number; entryIds: number[] } {
  try {
    const parsed: unknown = inputMasked ? JSON.parse(inputMasked) : null;
    if (!parsed || typeof parsed !== 'object') return { injected: 0, entryIds: [] };
    const o = parsed as { injected?: unknown; entryIds?: unknown };
    return {
      injected: typeof o.injected === 'number' ? o.injected : 0,
      entryIds: Array.isArray(o.entryIds)
        ? o.entryIds.filter((v): v is number => typeof v === 'number')
        : [],
    };
  } catch {
    return { injected: 0, entryIds: [] };
  }
}

/**
 * Settle every pending recall decision belonging to a task.
 *
 * @param taskId - Task that just reached a terminal state. / 終端に達したタスクID
 * @returns Counts examined and settled. / 検査件数と確定件数
 */
export async function settleKnowledgeDecisions(
  taskId: number,
): Promise<{ checked: number; settled: number }> {
  try {
    const pending = await prisma.agentDecisionTrace.findMany({
      where: { taskId, consistency: 'pending' },
      select: { id: true, nodeKey: true, inputMasked: true },
    });
    const recalls = pending.filter((row) => kindFromNodeKey(row.nodeKey) === 'knowledge_use');
    if (recalls.length === 0) return { checked: 0, settled: 0 };

    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (!task || !TERMINAL.has(task.status)) return { checked: recalls.length, settled: 0 };

    const usage = await readUsageDeclaration(taskId);
    const now = new Date();
    let settled = 0;
    for (const row of recalls) {
      const { injected, entryIds } = readRecall(row.inputMasked);
      const verdict = judgeRecall(injected, entryIds, usage);
      await prisma.agentDecisionTrace.update({
        where: { id: row.id },
        data: { consistency: verdict.consistency, consistencyNote: verdict.note, verifiedAt: now },
      });
      // The verdict says whether the RECALL helped; ranking needs to know which
      // ENTRIES did. Recorded per entry here, at the one moment both the
      // injected set and the declaration are in hand.
      if (usage?.declared) await recordEntryUsage(taskId, entryIds, usage.used);
      settled += 1;
    }
    log.info({ taskId, settled }, '[decision-ledger] settled knowledge recalls');
    return { checked: recalls.length, settled };
  } catch (err) {
    log.warn({ err, taskId }, '[decision-ledger] recall settlement failed (non-fatal)');
    return { checked: 0, settled: 0 };
  }
}

/**
 * Read the agent's own declaration of which entries it used, from the task's
 * workflow artifacts. Absent for most tasks — that absence is reported as
 * unjudged rather than filled in with an assumption.
 */
async function readUsageDeclaration(
  taskId: number,
): Promise<{ declared: boolean; used: number[] } | null> {
  try {
    const [{ readWorkflowArtifacts }, { parseKnowledgeUsage, mergeKnowledgeUsage }] =
      await Promise.all([
        import('../workflow/outcome-telemetry'),
        import('../memory/outcome-reinforcement'),
      ]);
    const artifacts = await readWorkflowArtifacts(taskId);
    const merged = mergeKnowledgeUsage(artifacts.map((md) => parseKnowledgeUsage(md)));
    return { declared: merged.declared, used: merged.used };
  } catch {
    return null;
  }
}

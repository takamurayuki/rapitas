/**
 * decision-ledger/record-recall
 *
 * Records the decision to pull knowledge into a phase's context. Recalls that
 * return nothing are recorded too — they are the majority (89 attempts, 12
 * actual retrievals in 24h, measured 2026-08-25), and a ledger that only
 * records the recalls that found something cannot see that.
 */

import { createLogger } from '../../config/logger';

const log = createLogger('decision-ledger:recall');

/** One knowledge recall and what it produced. */
export interface RecallDecision {
  taskId: number;
  /** Ids injected into context. Empty means the recall found nothing. */
  entryIds: number[];
  /** Similarity floor the recall ran at. */
  minSimilarity: number;
}

/**
 * Record one recall. Fail-open — retrieval must never be blocked by its own
 * bookkeeping.
 *
 * @param decision - The recall and its result. / 想起内容と結果
 */
export async function recordRecallDecision(decision: RecallDecision): Promise<void> {
  try {
    const { recordDecision } = await import('../observability/decision-trace');
    const found = decision.entryIds.length;
    await recordDecision({
      taskId: decision.taskId,
      nodeKey: `task${decision.taskId}:knowledge-recall:${Date.now()}`,
      kind: 'resource_access',
      summary: found > 0 ? `知識想起: ${found}件を注入` : '知識想起: 該当なし',
      input: { injected: found, entryIds: decision.entryIds.slice(0, 20) },
      candidates: [{ id: found > 0 ? `entries:${found}` : 'none', label: `${found}件` }],
      adoptedId: found > 0 ? `entries:${found}` : 'none',
      adoptedReason:
        found > 0
          ? `類似度 ${decision.minSimilarity} 以上の知識 ${found} 件がこのタスクに役立つと判断`
          : `類似度 ${decision.minSimilarity} 以上に該当する知識が無かった`,
    });
  } catch (err) {
    log.warn({ err, taskId: decision.taskId }, '[decision-ledger] recall not recorded (non-fatal)');
  }
}

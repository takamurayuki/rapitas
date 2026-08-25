/**
 * decision-ledger/record-filing
 *
 * Records the decision to file a task from the backlog. Auto-filing has never
 * been measured: 154 of 176 filings in the last 60 days reached done, but a
 * completion rate is not a measure of worth — a task nobody needed also
 * completes. What is claimed at filing time is that the concern will be
 * resolved, or the idea will have its effect.
 */

import { createLogger } from '../../config/logger';

const log = createLogger('decision-ledger:filing');

/** What was promoted, and why this one. */
export interface FilingDecision {
  /** Task created by the promotion. */
  taskId: number;
  /** Backlog arm the bandit picked. */
  source: 'concern' | 'idea';
  /** Id of the concern or idea promoted. */
  sourceId: number;
  /** Its title, for a readable subject. */
  title: string;
  /** Why this item was picked (severity / priority / arm). */
  basis: string;
  /** What filing it is expected to achieve. */
  expectation: string;
}

/**
 * Record one filing decision. Fail-open — the ledger must never block a
 * promotion, and a promotion that ran is more valuable than one that was
 * rolled back for bookkeeping.
 *
 * @param decision - The filing and its expectation. / 起票内容と期待
 */
export async function recordFilingDecision(decision: FilingDecision): Promise<void> {
  try {
    const { recordDecision } = await import('../observability/decision-trace');
    await recordDecision({
      taskId: decision.taskId,
      nodeKey: `task${decision.taskId}:task-filing:${Date.now()}`,
      kind: 'resource_access',
      summary: `起票: ${decision.title}`.slice(0, 200),
      input: { source: decision.source, sourceId: decision.sourceId },
      candidates: [
        { id: `${decision.source}:${decision.sourceId}`, label: decision.title.slice(0, 120) },
      ],
      adoptedId: `${decision.source}:${decision.sourceId}`,
      adoptedReason: `${decision.basis} / 期待: ${decision.expectation}`,
    });
  } catch (err) {
    log.warn({ err, taskId: decision.taskId }, '[decision-ledger] filing not recorded (non-fatal)');
  }
}

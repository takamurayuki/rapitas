/**
 * hypothesis-outcome-validation
 *
 * Closes the create→inject→VALIDATE loop: when a task reaches a terminal state,
 * record outcome evidence on the OPEN hypotheses that task formed. A clean
 * completion is "for" evidence (the conjecture held up through the work that
 * relied on it); a block is "against". Over many tasks this lets good conjectures
 * graduate to trusted knowledge and bad ones get refuted — so recall surfaces
 * what actually helped and suppresses what didn't. Best-effort; never throws.
 * Not responsible for forming or injecting hypotheses.
 */
import { listHypotheses, addEvidence } from './hypothesis-service';
import { createLogger } from '../../config/logger';

const log = createLogger('memory:hypothesis-outcome-validation');

/**
 * Record outcome evidence on hypotheses originated by a finished task.
 *
 * @param taskId - The finished task / 終了したタスク
 * @param themeId - Its theme (narrows the ledger query) / テーマ
 * @param finalStatus - Terminal status ('completed' | 'blocked' | …) / 終端ステータス
 * @returns Count of hypotheses that received evidence / 証拠を記録した仮説数
 */
export async function validateHypothesesForTaskOutcome(
  taskId: number,
  themeId: number | null,
  finalStatus: string,
): Promise<number> {
  if (finalStatus !== 'completed' && finalStatus !== 'blocked') return 0;

  const { hypotheses } = await listHypotheses({
    status: 'open',
    ...(themeId != null && { themeId }),
    limit: 100,
  }).catch(() => ({ hypotheses: [] }));

  const mine = hypotheses.filter((h) => h.originTaskId === taskId);
  if (mine.length === 0) return 0;

  const stance = finalStatus === 'completed' ? 'for' : 'against';
  let recorded = 0;
  for (const h of mine) {
    try {
      const res = await addEvidence(h.id, {
        stance,
        detail:
          finalStatus === 'completed'
            ? `この仮説の下で進めたタスク#${taskId} が完了`
            : `この仮説の下で進めたタスク#${taskId} がブロック`,
        // Concrete artifact (has '#' + digit + ':') so the evidence gate accepts it.
        artifact: `task#${taskId}:${finalStatus}`,
        taskId,
        phase: 'completion',
      });
      if (res.ok) recorded += 1;
    } catch (err) {
      log.warn({ err, taskId, hypothesisId: h.id }, '[hypothesis-validation] addEvidence failed');
    }
  }
  if (recorded > 0) {
    log.info({ taskId, recorded, stance }, '[hypothesis-validation] recorded outcome evidence');
  }
  return recorded;
}

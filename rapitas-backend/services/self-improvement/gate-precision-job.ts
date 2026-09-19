/**
 * gate-precision-job
 *
 * The scheduled pipeline for the gate-precision ledger: record newly-resolved
 * verify_repair disputes, then run the stagnation-style review over them.
 * Fail-open per stage (a broken stage logs and yields 0, never aborts the
 * scheduler tick). Returns the produced item count as the backlog-scheduler
 * HANDLERS contract requires.
 */
import { createLogger } from '../../config/logger';
import { collectAndRecordGatePrecisionCases } from './gate-precision-ledger';
import { runGatePrecisionReview } from './gate-precision-watcher';

const log = createLogger('self-improvement:gate-precision-job');

/**
 * Run one gate-precision pass. Stages are independent: a failure in one is
 * logged and the rest still run.
 *
 * @returns Cases recorded + concerns filed. / 生成件数
 */
export async function runGatePrecisionJob(): Promise<number> {
  const recorded = await collectAndRecordGatePrecisionCases().catch((err) => {
    log.warn({ err }, '[gate-precision-job] case recording failed — continuing');
    return 0;
  });

  const filed = await runGatePrecisionReview().catch((err) => {
    log.warn({ err }, '[gate-precision-job] review failed — continuing');
    return 0;
  });

  log.info({ recorded, filed }, '[gate-precision-job] pass complete');
  return recorded + filed;
}

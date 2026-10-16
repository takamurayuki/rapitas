/**
 * miss-ledger-job
 *
 * The scheduled pipeline for the detection-miss learning loop: record new miss
 * cases → generate cue suggestions → re-derive the approval mode → auto-apply
 * ONLY when the derived mode allows it. Fail-open per stage (a broken stage
 * logs and yields 0, never aborts the scheduler tick). Returns the produced
 * item count as the backlog-scheduler HANDLERS contract requires.
 */
import { createLogger } from '../../config/logger';
import { collectAndRecordMissCases } from './detection-miss-ledger';
import { generateMissSuggestions } from './miss-signature-suggester';
import { applyPendingAutomatically } from './miss-signature-service';

const log = createLogger('self-improvement:miss-ledger-job');

/**
 * Run one miss-ledger pass. Stages are independent: a failure in one is
 * logged and the rest still run.
 *
 * @returns Cases recorded + suggestions generated + auto-applied. / 生成件数
 */
export async function runMissLedgerJob(): Promise<number> {
  const recorded = await collectAndRecordMissCases().catch((err) => {
    log.warn({ err }, '[miss-ledger-job] case recording failed — continuing');
    return 0;
  });

  const generated = await generateMissSuggestions().catch((err) => {
    log.warn({ err }, '[miss-ledger-job] suggestion generation failed — continuing');
    return 0;
  });

  // applyPendingAutomatically re-derives the mode itself and refuses unless
  // it comes out 'auto' — no mode check needed here.
  const applied = await applyPendingAutomatically().catch((err) => {
    log.warn({ err }, '[miss-ledger-job] auto-apply failed — continuing');
    return 0;
  });

  log.info({ recorded, generated, applied }, '[miss-ledger-job] pass complete');
  return recorded + generated + applied;
}

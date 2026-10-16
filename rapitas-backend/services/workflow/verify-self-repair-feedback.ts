/**
 * verify-self-repair-feedback
 *
 * Handles verify.md repair-feedback generation for verify-self-repair: numeric
 * tally sanitisation, failure-location extraction, and marker-wrapped
 * block merge/write. Not responsible for repair-budget judgement or state
 * transitions.
 */
import { createLogger } from '../../config/logger';
import { readWorkflowFile, writeWorkflowFile } from './workflow-file-utils';

const log = createLogger('workflow:verify-self-repair');

export {
  REPAIR_FEEDBACK_START,
  REPAIR_FEEDBACK_END,
  sanitizeRepairReason,
  buildRepairFeedbackBlock,
  mergeRepairFeedback,
} from './verify-repair-feedback-content';
import { buildRepairFeedbackBlock, mergeRepairFeedback } from './verify-repair-feedback-content';
import { repairFeedbackSources } from './verify-repair-pollution';

/**
 * Write the verify failure back to verify.md so the re-run implementer reads
 * it as feedback (the implementer context surfaces verify.md). Best-effort.
 *
 * @param taskId - Task id / タスクID
 * @param reason - Validator summary / バリデータの要約
 * @param verifyContent - The rejected verify.md (fallback when the file is unreadable) / 却下されたverify.md
 * @param attempt - 1-based attempt number / 試行回数
 */
export async function writeRepairFeedback(
  taskId: number,
  reason: string,
  verifyContent: string,
  attempt: number,
): Promise<void> {
  try {
    // Belongs on verify.md, not question.md (Q&A) — the implementer re-reads it.
    const prior = (await readWorkflowFile(taskId, 'verify')) ?? verifyContent ?? '';
    // A corrupt report must be dropped, not decorated. Appending feedback to a
    // log-polluted body re-saves the pollution, so the next validation fails
    // for the identical reason and the agent is asked to fix a file it was
    // handed still broken — measured on task 1160: six versions, same three
    // HARD patterns, body unchanged across five bounces, then halted.
    const { base, quoted } = repairFeedbackSources(prior, verifyContent);
    const block = buildRepairFeedbackBlock(reason, attempt, quoted);
    await writeWorkflowFile(taskId, 'verify', mergeRepairFeedback(base, block));
  } catch (err) {
    log.warn({ err, taskId }, '[verify-repair] Failed to write repair feedback to verify.md');
  }
}

/**
 * PromptEvolutionBandScope
 *
 * Difficulty-band membership check for a staged prompt addendum's rollout
 * scope. Split out of prompt-evolution-worker.ts to keep that file under the
 * 300-line soft limit (COMPONENT_SPLITTING_POLICY.md) — used only by
 * getApprovedRoleAddendum's stagedComplexityBands filter (task #970).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveComplexityBand } from './comparison/prompt-band-evidence';

const log = createLogger('self-learning:prompt-evolution-band-scope');

/**
 * Whether a staged addendum's band scope excludes taskId. Returns false (do
 * not exclude) whenever taskId, the task, or its complexityScore is
 * unavailable — an unscored task cannot establish membership in a band list,
 * so it falls back to the safer "not excluded by band" behavior (mirrors the
 * existing stagedTaskIds withholding, but fails open instead of closed since
 * an unscored task is not proof of exclusion either way).
 *
 * @param stagedComplexityBands - Bands the addendum is limited to, or null for unscoped. / 適用対象の難度帯
 * @param taskId - Task about to run this role. / 対象タスクID
 * @returns True when the task's band is NOT in the allowed list. / 除外すべきか
 */
export async function isExcludedByComplexityBand(
  stagedComplexityBands: string[] | null,
  taskId: number | undefined,
): Promise<boolean> {
  if (stagedComplexityBands === null) return false;
  if (taskId === undefined) return false;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { complexityScore: true },
    });
    if (task?.complexityScore == null) return false;
    const band = resolveComplexityBand(task.complexityScore);
    return !stagedComplexityBands.includes(band);
  } catch (err) {
    log.warn({ err, taskId }, '[prompt-evolution] band-scope lookup failed; not excluding');
    return false;
  }
}

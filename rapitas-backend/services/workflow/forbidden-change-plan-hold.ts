/**
 * forbidden-change-plan-hold
 *
 * Withholds plan AUTO-approval when the plan commits to a change only a human
 * can authorize. Decides nothing else: the verify-time schema-change gate stays
 * the last line of defence, and this module never mutates task state.
 *
 * Why it exists: the schema-change gate needs `Task.forbiddenChangeOverride`,
 * which only the human approve-plan path sets. Discovering that at VERIFY time
 * means the whole implementation was already paid for. Measured 2026-09-27:
 * task 1100 implemented 41 files and a Prisma model before the gate refused it,
 * and task 1103 reached the same wall after a full implement + verify round.
 * Holding at `plan_created` instead costs one planner run and asks the human the
 * same question hours earlier.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { extractPlanDeclaredFiles } from './plan-declared-files';
import { isSchemaFilePath } from '../agents/verification/schema-change-gate';

const log = createLogger('workflow:forbidden-change-plan-hold');

/** Transition cause recorded when auto-approval is withheld for this reason. */
export const PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE = 'plan_forbidden_change_hold';

/** Why auto-approval was withheld, or null when it may proceed. */
export interface ForbiddenChangeHold {
  /** Declared paths that need the human override. / 人間承認が必要な宣言パス */
  paths: string[];
  /** Ready-to-act instruction for the operator. / 運用者向けの具体的な指示 */
  instruction: string;
}

/**
 * Build the operator instruction for a held plan.
 *
 * @param taskId - Held task. / 対象タスク
 * @param paths - Declared forbidden paths. / 宣言された禁止パス
 * @returns One actionable sentence. / 実行可能な指示文
 */
export function buildOverrideInstruction(taskId: number, paths: string[]): string {
  return (
    `タスク #${taskId} の plan.md は人間の承認が必要な変更を宣言しています: ${paths.join(', ')}。` +
    `続行する場合は POST /workflow/tasks/${taskId}/approve-plan に ` +
    `overrideForbiddenChange:true と overrideReason を付けて承認してください。` +
    `マージ後は prisma db push / generate のためサーバー再起動が必要です。`
  );
}

/**
 * Whether plan auto-approval must be withheld for this task.
 *
 * Fails OPEN: an unreadable plan or task row returns null (approval proceeds).
 * The verify-time gate still refuses an unauthorized schema change, so a missed
 * hold costs spend rather than correctness — while a hold applied on missing
 * information would stall every plan behind a transient read error.
 *
 * @param taskId - Task sitting at plan_created. / plan_created のタスクID
 * @returns The hold with its reason, or null when approval may proceed. / 保留理由、無ければ null
 */
export async function resolveForbiddenChangePlanHold(
  taskId: number,
): Promise<ForbiddenChangeHold | null> {
  let plan: { content: string | null } | null = null;
  let task: { forbiddenChangeOverride: boolean | null } | null = null;
  try {
    [plan, task] = await Promise.all([
      prisma.workflowFile.findFirst({
        where: { taskId, fileType: 'plan' },
        orderBy: { updatedAt: 'desc' },
        select: { content: true },
      }),
      prisma.task.findUnique({
        where: { id: taskId },
        select: { forbiddenChangeOverride: true },
      }),
    ]);
  } catch (err) {
    // Fail open (see the doc comment): the verify-time gate still refuses an
    // unauthorized schema change, so a missed hold costs spend, never correctness.
    log.warn({ err, taskId }, '[forbidden-change-plan-hold] plan/task unreadable — not holding');
    return null;
  }
  if (!plan?.content || !task) return null;
  if (task.forbiddenChangeOverride === true) return null;

  const paths = extractPlanDeclaredFiles(plan.content).filter((file) => isSchemaFilePath(file));
  if (paths.length === 0) return null;

  const instruction = buildOverrideInstruction(taskId, paths);
  log.warn(
    { taskId, paths },
    '[forbidden-change-plan-hold] plan declares a human-override-only change — withholding auto-approval',
  );
  return { paths, instruction };
}

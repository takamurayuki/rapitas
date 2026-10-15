/**
 * workflow-disabled
 *
 * Single source of truth for "is the multi-phase workflow disabled for this
 * task" — task-level `Task.workflowDisabled` OR the global
 * `UserSettings.workflowDisabledGlobally`. Mirrors plan-auto-approve.ts's
 * `resolveEffectiveAutoApprovePlan` OR-pattern (task-level flag wins, global
 * flag is the fallback default).
 */
import { prisma } from '../../config/database';

// boundary-tests: manual — this resolver is a fail-open boolean (returns
// `false`, not `null`, when the row is missing), so the generated
// null-contract template does not apply. See workflow-disabled.boundary.test.ts.

/**
 * Resolves whether the multi-phase workflow (research.md/plan.md as
 * separately-saved artifacts, phase-critic gate, per-phase agent dispatch) is
 * disabled for this task — task-level flag OR the global settings flag.
 *
 * NOTE: read via cast — both columns are pending Prisma client regen until
 * the next backend restart (see CLAUDE.md: schema changes require a manual
 * restart; dev.js re-runs `prisma db push`/`generate` on startup). Before
 * that restart this safely resolves to false (fields undefined in the row).
 *
 * @param taskId - Task whose workflow-disabled state is being resolved. / 対象タスク
 * @returns True when the task should skip straight to direct implementation. / ワークフローを無効化するか
 */
export async function resolveEffectiveWorkflowDisabled(taskId: number): Promise<boolean> {
  // Each read is independently fail-open (a settings-lookup failure must not
  // prevent the task-level flag from being checked, and vice versa) — this is
  // a convenience short-circuit, not a correctness requirement, and callers
  // (execute-route, workflow-orchestrator) must not fail just because one
  // lookup couldn't complete.
  const [settings, task] = await Promise.all([readUserSettingsSafely(), readTaskSafely(taskId)]);
  if (!task) return false;
  return !!task.workflowDisabled || !!settings?.workflowDisabledGlobally;
}

// NOTE: cast on return — both columns are pending Prisma client regen until
// the next backend restart (see the module doc comment above).
async function readUserSettingsSafely(): Promise<{
  workflowDisabledGlobally?: boolean | null;
} | null> {
  try {
    const row = await prisma.userSettings.findFirst();
    return row as unknown as { workflowDisabledGlobally?: boolean | null } | null;
  } catch {
    return null;
  }
}

async function readTaskSafely(
  taskId: number,
): Promise<{ workflowDisabled?: boolean | null } | null> {
  try {
    const row = await prisma.task.findUnique({ where: { id: taskId } });
    return row as unknown as { workflowDisabled?: boolean | null } | null;
  } catch {
    return null;
  }
}

/**
 * workflow-reconciler-stale-halt
 *
 * Enforces one invariant: a task that has finished is not halted. Owns only the
 * clearing — it never halts anything, and it never changes a task's status.
 *
 * Why a sweep instead of fixing the writers. `haltIfIterationBudgetExceeded`
 * writes haltReason/haltedAt/resumeCondition and only halt-release.ts clears
 * them, so a task that halted once and later completed keeps the columns
 * forever. Measured 2026-10-07: 4 of the 5 tasks holding a haltReason were
 * already status=done (#1031/#1060/#1110/#1112). There are nine separate places
 * that write `status:'done', workflowStatus:'completed'` (auto-merge-watcher,
 * auto-merge-recovery, blocked-pr-retry-recovery ×2, subtask-completion-handler,
 * verify-settle-artifact-recovery, resume-completion, task-executor,
 * timeout-handler); patching each would duplicate the rule and the next writer
 * would miss it. One invariant pass also heals the rows already in the table.
 *
 * Why it matters: `isTaskHaltActive` has to special-case terminal tasks because
 * of this, and anything that reads haltReason without that guard reads a
 * finished task as halted.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:reconciler:stale-halt');

/** Columns the halt occupies; all three are cleared together. */
interface HaltClearDeps {
  findStale: () => Promise<Array<{ id: number; haltReason: string | null }>>;
  clear: (id: number) => Promise<unknown>;
}

const defaultDeps: HaltClearDeps = {
  findStale: () => {
    // The halt columns are newer than the generated client (same cast as the
    // scheduler and halt-release.ts use).
    const taskModel = prisma.task as unknown as {
      findMany: (args: unknown) => Promise<Array<{ id: number; haltReason: string | null }>>;
    };
    return taskModel.findMany({
      where: {
        haltReason: { not: null },
        OR: [{ status: 'done' }, { status: 'cancelled' }, { workflowStatus: 'completed' }],
      },
      select: { id: true, haltReason: true },
    });
  },
  clear: (id) => {
    const taskModel = prisma.task as unknown as {
      update: (args: unknown) => Promise<unknown>;
    };
    return taskModel.update({
      where: { id },
      data: { haltReason: null, haltedAt: null, resumeCondition: null },
    });
  },
};

/**
 * Clear the halt columns on tasks that have already finished.
 *
 * Only ever clears, and only on a task whose own status says it is terminal, so
 * it cannot release a halt that is still doing its job.
 *
 * @param deps - Test overrides. / テスト用差し替え
 * @returns How many tasks were cleared. / クリアした件数
 */
export async function clearStaleHalts(deps: Partial<HaltClearDeps> = {}): Promise<number> {
  const d: HaltClearDeps = { ...defaultDeps, ...deps };
  const stale = await d.findStale().catch((err) => {
    log.warn({ err }, '[stale-halt] lookup failed — skipping this cycle');
    return [] as Array<{ id: number; haltReason: string | null }>;
  });
  if (stale.length === 0) return 0;

  let cleared = 0;
  for (const t of stale) {
    // Per-task isolation: one bad row must not starve the rest.
    const ok = await d
      .clear(t.id)
      .then(() => true)
      .catch((err) => {
        log.warn({ err, taskId: t.id }, '[stale-halt] clear failed');
        return false;
      });
    if (ok) {
      cleared++;
      log.info(
        { taskId: t.id, previousHaltReason: t.haltReason },
        '[stale-halt] cleared a halt left on a finished task',
      );
    }
  }
  return cleared;
}

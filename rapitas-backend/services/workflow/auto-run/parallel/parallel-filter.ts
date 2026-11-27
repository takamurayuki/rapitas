/**
 * parallel-filter
 *
 * Builds the parallel-safety filter selectNextTask applies (task 1552): reads
 * each side's plan and description, the dependency table and the import
 * relation, then asks judgePair. Also records refused candidates. Split out of
 * companion-selection.ts for the file-size limit. Not responsible for choosing.
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { logCycleEvent } from '../../../observability';
import {
  judgePair,
  collectPlanFiles,
  extractDependencyRefs,
  type PairSide,
} from './parallel-safety-rules';
import { createBroadDirectoryCheck } from './shared-directories';
import { findImportRelation } from './import-relation';
import type { ParallelFilter, ParallelRejection } from './parallel-types';

/** A running task to compare candidates against. */
export interface Opponent {
  taskId: number;
  /** Same theme → a missing plan refuses; another theme → file rules pass. */
  sameTheme: boolean;
}

/** Collaborators, injectable for tests. */
export interface ParallelFilterDeps {
  readPlan: (taskId: number) => Promise<string | null>;
  importRelated: (cwd: string, a: string[], b: string[]) => Promise<boolean>;
}

const defaultFilterDeps: ParallelFilterDeps = {
  readPlan: async (taskId) => {
    const { readWorkflowFile } = await import('../../workflow-file-utils');
    return readWorkflowFile(taskId, 'plan').catch(() => null);
  },
  importRelated: async (cwd, a, b) => (await findImportRelation(cwd, a, b)) != null,
};

type DependencyModel = {
  findFirst: (args: unknown) => Promise<unknown>;
};

/**
 * Build the parallel-safety filter for a set of opponents.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param opponents - Running tasks to compare with / 比較相手
 * @param cwd - Repository working directory (import check) / 作業ディレクトリ
 * @param deps - Test overrides / テスト用差し替え
 * @returns Filter for selectNextTask / 選定用フィルタ
 */
export function buildParallelFilter(
  prisma: PrismaClient,
  opponents: Opponent[],
  cwd: string | null,
  deps: Partial<ParallelFilterDeps> = {},
): ParallelFilter {
  const d: ParallelFilterDeps = { ...defaultFilterDeps, ...deps };
  const isBroadDirectory = cwd ? createBroadDirectoryCheck(cwd) : undefined;
  const sides = new Map<number, Promise<PairSide>>();
  const side = (taskId: number) => {
    if (!sides.has(taskId)) {
      sides.set(
        taskId,
        (async () => {
          const [plan, task] = await Promise.all([
            d.readPlan(taskId).catch(() => null),
            prisma.task
              .findUnique({ where: { id: taskId }, select: { description: true } })
              .catch(() => null),
          ]);
          return { taskId, plan, description: task?.description ?? null };
        })(),
      );
    }
    return sides.get(taskId)!;
  };

  return async (candidate) => {
    const cand = await side(candidate.id);
    const refs = [
      ...extractDependencyRefs(cand.description, cand.taskId),
      ...extractDependencyRefs(cand.plan, cand.taskId),
    ];
    const incomplete = new Set<number>();
    if (refs.length > 0) {
      const rows = await prisma.task
        .findMany({ where: { id: { in: refs } }, select: { id: true, status: true } })
        .catch(() => [] as Array<{ id: number; status: string }>);
      // Same meaning of "done" as UNMET_DEPENDENCIES_EXCLUDED.
      for (const r of rows) if (r.status !== 'done') incomplete.add(r.id);
    }
    for (const o of opponents) {
      if (o.taskId === candidate.id) continue;
      const act = await side(o.taskId);
      const depModel = (prisma as unknown as { taskDependency?: DependencyModel }).taskDependency;
      const link = depModel
        ? await depModel
            .findFirst({
              where: {
                OR: [
                  { taskId: candidate.id, dependsOnTaskId: o.taskId },
                  { taskId: o.taskId, dependsOnTaskId: candidate.id },
                ],
              },
              select: { id: true },
            })
            .catch(() => null)
        : null;
      const ctx = {
        requirePlans: o.sameTheme,
        tableLinked: link != null,
        incompleteTaskIds: incomplete,
        isBroadDirectory,
      };
      const verdict = judgePair(cand, act, ctx);
      if (!verdict.ok) return { ...verdict, detail: `vs task ${o.taskId}: ${verdict.detail}` };
      const a = collectPlanFiles(cand.plan).files;
      const b = collectPlanFiles(act.plan).files;
      if (
        cwd &&
        a.length > 0 &&
        b.length > 0 &&
        (await d.importRelated(cwd, a, b).catch(() => false))
      ) {
        return {
          ok: false,
          reason: 'import_relation',
          detail: `vs task ${o.taskId}: planned files import each other`,
        };
      }
    }
    return { ok: true };
  };
}

/**
 * Record each refused candidate (task.deferred, cause `parallel_rejected`).
 *
 * @param themeId - Theme / テーマID
 * @param rejected - Refusals / 不可だった候補
 * @param role - Which selection refused them / 選定の種類
 */
export function logParallelRejections(
  themeId: number,
  rejected: ParallelRejection[] | undefined,
  role: 'head' | 'companion',
): void {
  for (const r of rejected ?? []) {
    // NOTE: recorded as task.deferred + cause 'parallel_rejected' instead of a
    // new event name — the CycleEventName union lives outside this task's plan.
    logCycleEvent('task.deferred', {
      theme: themeId,
      task: r.taskId,
      cause: 'parallel_rejected',
      reason: r.reason,
      role,
      detail: r.detail.slice(0, 300),
      msg: 'candidate not run in parallel — it would collide with a running task',
    });
  }
}

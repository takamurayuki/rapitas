/**
 * Failure Impact Tree Route
 *
 * GET /tasks/:id/failure-impact-tree — returns the root-cause analysis and
 * subtask-dependency impact tree for a failed task (idea #11177). Read-only:
 * fetches the task and its subtask subtree via existing `parentId` data and
 * delegates to the pure {@link buildFailureImpactTree} for tree construction
 * and cycle/missing-data handling.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  buildFailureImpactTree,
  type FailureTaskSnapshot,
} from '../../services/workflow/failure-impact-tree';

const log = createLogger('routes:failure-impact-tree');

/**
 * Loads the failed task plus every descendant subtask (any depth) as plain
 * snapshots for {@link buildFailureImpactTree}. A single recursive query is
 * unavailable in the shared Prisma schema, so this walks level by level
 * (bounded by MAX_DEPTH to stay safe against unexpectedly deep/cyclic data).
 */
async function loadTaskFamilySnapshots(failedTaskId: number): Promise<FailureTaskSnapshot[]> {
  const MAX_DEPTH = 20;
  const select = { id: true, title: true, status: true, parentId: true, haltReason: true } as const;

  const root = await prisma.task.findUnique({ where: { id: failedTaskId }, select });
  if (!root) return [];

  const snapshots = new Map<number, FailureTaskSnapshot>();
  snapshots.set(root.id, { ...root, lastErrorMessage: null });

  let frontier = [root.id];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const children = await prisma.task.findMany({ where: { parentId: { in: frontier } }, select });
    const nextFrontier: number[] = [];
    for (const child of children) {
      if (snapshots.has(child.id)) continue;
      snapshots.set(child.id, { ...child, lastErrorMessage: null });
      nextFrontier.push(child.id);
    }
    frontier = nextFrontier;
  }

  return Array.from(snapshots.values());
}

const failureImpactTreeRoute = new Elysia().get(
  '/tasks/:id/failure-impact-tree',
  async ({ params, set }) => {
    const failedTaskId = parseInt(params.id, 10);
    if (Number.isNaN(failedTaskId)) {
      set.status = 400;
      return { error: 'invalid task id' };
    }

    try {
      const snapshots = await loadTaskFamilySnapshots(failedTaskId);
      return buildFailureImpactTree(failedTaskId, snapshots);
    } catch (err) {
      log.error({ err, failedTaskId }, '[failure-impact-tree] Failed to build failure impact tree');
      throw err;
    }
  },
  {
    params: t.Object({ id: t.String() }),
  },
);

export default failureImpactTreeRoute;

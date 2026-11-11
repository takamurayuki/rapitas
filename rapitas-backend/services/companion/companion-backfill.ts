/**
 * CompanionBackfill
 *
 * The one-off creation of `TaskCompanion` rows for tasks ラピ made before the
 * table existed (companion design 4.3, "既存のデータ"). Reads the audit trail:
 * `task.create` keeps the task in its `taskId` column, `roadmap.commit` keeps
 * every task it made in `resultJson.taskIds` — whether it finished (`executed`)
 * or stopped partway (`failed`), since the tasks it did make are real.
 * Tasks that are already done, or no longer exist, are left out.
 *
 * Planning is pure and separate from writing, so the dry run the script does
 * by default reports exactly what `apply` would create. Not responsible for
 * deciding when to run — that is the operator's call (see the script).
 */
import type { CompanionOrigin } from './companion-service';

/** An audit row, as the backfill reads it. */
export interface BackfillActionRow {
  id: number;
  capabilityId: string;
  status: string;
  taskId: number | null;
  resultJson: string | null;
}

/** One row the backfill would create. */
export interface PlannedCompanion {
  taskId: number;
  origin: Extract<CompanionOrigin, 'task_create' | 'roadmap_commit'>;
  sourceActionId: number;
}

/** Why a candidate task was not given a row. */
export interface BackfillPlan {
  create: PlannedCompanion[];
  skipped: { done: number[]; missing: number[]; alreadyTracked: number[] };
}

/** The ids a roadmap commit recorded, or none when its result cannot be read. */
function roadmapTaskIds(resultJson: string | null): number[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { taskIds?: unknown };
    return Array.isArray(parsed.taskIds)
      ? parsed.taskIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
      : [];
  } catch {
    return [];
  }
}

/**
 * Work out which rows to create.
 *
 * @param actions - task.create / roadmap.commit audit rows, oldest first / 監査行（古い順）
 * @param taskStatus - Status of every candidate task that still exists / 現存タスクの状態
 * @param tracked - Tasks that already have a companion row / 既に行があるタスク
 * @returns What to create, and what was skipped and why / 作成対象と除外理由
 */
export function planCompanionBackfill(
  actions: BackfillActionRow[],
  taskStatus: ReadonlyMap<number, string>,
  tracked: ReadonlySet<number>,
): BackfillPlan {
  const plan: BackfillPlan = { create: [], skipped: { done: [], missing: [], alreadyTracked: [] } };
  const seen = new Set<number>();
  for (const action of actions) {
    const candidates: Array<{ taskId: number; origin: PlannedCompanion['origin'] }> = [];
    if (action.capabilityId === 'task.create' && action.status === 'executed' && action.taskId) {
      candidates.push({ taskId: action.taskId, origin: 'task_create' });
    } else if (
      action.capabilityId === 'roadmap.commit' &&
      (action.status === 'executed' || action.status === 'failed')
    ) {
      for (const taskId of roadmapTaskIds(action.resultJson)) {
        candidates.push({ taskId, origin: 'roadmap_commit' });
      }
    }
    for (const { taskId, origin } of candidates) {
      // The first act that made a task is its source; a later one naming the
      // same id (should not happen) does not override it.
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      const status = taskStatus.get(taskId);
      if (tracked.has(taskId)) plan.skipped.alreadyTracked.push(taskId);
      else if (status === undefined) plan.skipped.missing.push(taskId);
      else if (status === 'done') plan.skipped.done.push(taskId);
      else plan.create.push({ taskId, origin, sourceActionId: action.id });
    }
  }
  return plan;
}

/** The slice of Prisma the backfill uses — injectable for tests. */
export interface BackfillDb {
  assistantAction: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: { id: 'asc' };
      select: Record<keyof BackfillActionRow, true>;
    }): Promise<BackfillActionRow[]>;
  };
  task: {
    findMany(args: {
      where: { id: { in: number[] } };
      select: { id: true; status: true };
    }): Promise<Array<{ id: number; status: string }>>;
  };
  taskCompanion: {
    findMany(args: {
      where: { taskId: { in: number[] } };
      select: { taskId: true };
    }): Promise<Array<{ taskId: number }>>;
    create(args: { data: PlannedCompanion }): Promise<unknown>;
  };
}

/**
 * Plan the backfill against the database and, when asked, write it.
 *
 * Rows are created one at a time: a task that gained a row in the meantime
 * (the unique key on taskId) fails alone and is reported, rather than
 * aborting the rest.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param options.apply - Write the rows; otherwise only report / true で書き込む（既定は報告のみ）
 * @returns The plan, and how many rows were written / 計画と作成件数
 */
export async function backfillCompanions(
  db: BackfillDb,
  options: { apply: boolean },
): Promise<BackfillPlan & { created: number; failed: number[] }> {
  const actions = await db.assistantAction.findMany({
    where: {
      OR: [
        { capabilityId: 'task.create', status: 'executed', taskId: { not: null } },
        { capabilityId: 'roadmap.commit', status: { in: ['executed', 'failed'] } },
      ],
    },
    orderBy: { id: 'asc' },
    select: { id: true, capabilityId: true, status: true, taskId: true, resultJson: true },
  });
  const ids = [
    ...new Set(
      actions.flatMap((a) =>
        a.capabilityId === 'task.create'
          ? a.taskId
            ? [a.taskId]
            : []
          : roadmapTaskIds(a.resultJson),
      ),
    ),
  ];
  const [tasks, existing] = ids.length
    ? await Promise.all([
        db.task.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }),
        db.taskCompanion.findMany({ where: { taskId: { in: ids } }, select: { taskId: true } }),
      ])
    : [[], []];
  const plan = planCompanionBackfill(
    actions,
    new Map(tasks.map((t) => [t.id, t.status])),
    new Set(existing.map((e) => e.taskId)),
  );
  let created = 0;
  const failed: number[] = [];
  if (options.apply) {
    for (const row of plan.create) {
      try {
        await db.taskCompanion.create({ data: row });
        created += 1;
      } catch {
        failed.push(row.taskId);
      }
    }
  }
  return { ...plan, created, failed };
}

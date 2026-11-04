/**
 * WorkspaceBackfill
 *
 * Gives the rows that existed before tenancy an owner.
 *
 * Only ever touches rows whose `workspaceId` IS NULL, which is what makes it
 * safe to expose and safe to re-run: it can hand unowned data to a workspace,
 * but it can never move data from one workspace to another, and a second run
 * finds nothing left to do.
 *
 * The ownership write is raw SQL rather than `updateMany` for a measured
 * reason — see claimUnownedRows.
 *
 * NOT responsible for creating the workspace or for deciding who should get
 * the data — see workspace-provisioning and the route.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getOwnedModels } from './owned-models';
import { runAcrossAllWorkspaces } from './workspace-context';

const log = createLogger('tenancy:backfill');

/** One model's result. `error` is set instead of `claimed` when it failed. */
export interface BackfillModelResult {
  model: string;
  claimed: number;
  error?: string;
}

export interface BackfillResult {
  workspaceId: number;
  totalClaimed: number;
  /** Models that actually had unowned rows, largest first. */
  models: BackfillModelResult[];
  failed: BackfillModelResult[];
}

/** `Category` → `category`, which is how a delegate is named on the client. */
const delegateName = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Model names are safe to interpolate as table names because they come from
 * the generated client's DMMF, and no model in this schema carries `@@map`
 * (checked 2026-10-28), so the table name IS the model name. This guards the
 * day one of those two facts stops being true.
 */
const BARE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * The one client method the claim needs.
 *
 * Injected rather than reached for, following tenancy.routes.ts: the
 * alternative is `mock.module` on the Prisma client, which bun applies
 * process-wide to every other test file in the run. Production passes nothing
 * and gets the real client.
 */
export interface RawExecutor {
  $executeRawUnsafe: (sql: string) => Promise<number>;
}

/**
 * Hand every unowned row to `workspaceId`.
 *
 * Raw SQL, not `updateMany`, and that is the point of this function rather
 * than a detail of it. Prisma fires `@updatedAt` on `updateMany`: measured
 * 2026-10-28, claiming a row seeded at 2023-11-14 moved its `updatedAt` to the
 * moment of the call. 53 of the owned models carry `@updatedAt`, so a claim
 * written that way rewrites the history of every row it touches — the task
 * list, the activity log and the knowledge ledger would all sort as though
 * everything had been edited at once, and the real timestamps are not
 * recoverable. An UPDATE that names only `workspaceId` changes only
 * `workspaceId`. Pinned by workspace-backfill.integration.test.ts.
 *
 * Needs no `runAcrossAllWorkspaces`: a raw statement never reaches the
 * extension's `$allModels` hook, so there is no scope to escape. `countUnownedRows`
 * below goes through a delegate and does need it.
 *
 * @param workspaceId - The workspace that should own them / 所有させるワークスペース
 * @returns Per-model counts and any failures / モデル別件数と失敗
 * @throws {Error} When workspaceId is not an integer / workspaceId が整数でない場合
 */
export async function claimUnownedRows(
  workspaceId: number,
  db: RawExecutor = prisma,
): Promise<BackfillResult> {
  if (!Number.isInteger(workspaceId)) {
    throw new Error(`[tenancy] refusing to backfill with a non-integer workspace: ${workspaceId}`);
  }
  const models: BackfillModelResult[] = [];
  const failed: BackfillModelResult[] = [];

  for (const model of [...getOwnedModels()].sort()) {
    if (!BARE_IDENTIFIER.test(model)) {
      // Silently skipping would leave the model's rows visible to everyone,
      // which is the one outcome worth shouting about.
      failed.push({ model, claimed: 0, error: 'model name is not a bare identifier' });
      continue;
    }
    try {
      const claimed = await db.$executeRawUnsafe(
        `UPDATE "${model}" SET "workspaceId" = ${workspaceId} WHERE "workspaceId" IS NULL`,
      );
      if (claimed > 0) models.push({ model, claimed });
    } catch (error) {
      failed.push({
        model,
        claimed: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  models.sort((a, b) => b.claimed - a.claimed);
  const totalClaimed = models.reduce((sum, m) => sum + m.claimed, 0);
  log.info(
    { workspaceId, totalClaimed, models: models.length, failed: failed.length },
    'claimed unowned rows for a workspace',
  );
  return { workspaceId, totalClaimed, models, failed };
}

/**
 * How many unowned rows each model still has, without changing anything.
 *
 * @returns Per-model counts of rows no workspace owns / 未所有行のモデル別件数
 */
export async function countUnownedRows(): Promise<{
  totalUnowned: number;
  models: BackfillModelResult[];
}> {
  return runAcrossAllWorkspaces(async () => {
    const client = prisma as unknown as Record<
      string,
      { count: (args: unknown) => Promise<number> } | undefined
    >;
    const models: BackfillModelResult[] = [];
    for (const model of [...getOwnedModels()].sort()) {
      const delegate = client[delegateName(model)];
      if (!delegate || typeof delegate.count !== 'function') continue;
      try {
        const count = await delegate.count({ where: { workspaceId: null } });
        if (count > 0) models.push({ model, claimed: count });
      } catch (error) {
        models.push({
          model,
          claimed: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    models.sort((a, b) => b.claimed - a.claimed);
    return { totalUnowned: models.reduce((s, m) => s + m.claimed, 0), models };
  });
}

/** How deep a subtask chain the adoption follows before giving up. */
const MAX_ADOPTION_PASSES = 10;

export interface SubtaskAdoptionResult {
  /** Subtasks that were given their parent's workspace. */
  adopted: number;
  /** Statements run; more than one means a chain deeper than one level. */
  passes: number;
}

/**
 * Give every unowned subtask its parent's workspace.
 *
 * Subtasks created by a sessionless request were left NULL under parents that
 * belong to a workspace, which made them invisible — and un-updatable — for
 * the parent's signed-in owner (tasks 1428/1480/1481, found 2026-11-04).
 * claimUnownedRows cannot settle that: it hands EVERY unowned row of every
 * model to one workspace, whereas a subtask's owner is not a choice — it is
 * its parent's.
 *
 * Same guarantees as the claim: touches only rows whose workspaceId IS NULL,
 * so it never moves data between workspaces and a re-run finds nothing; and
 * raw SQL naming only `workspaceId`, so `@updatedAt` is left alone. A child
 * whose parent is itself unowned is skipped — it has nothing to inherit.
 * Each pass resolves one more level of a chain, so it repeats until a pass
 * changes nothing.
 *
 * @param db - Raw executor, the real client by default / 生SQL実行器(既定は実クライアント)
 * @returns How many subtasks were adopted / 引き取ったサブタスク数
 */
export async function adoptOrphanedSubtasks(
  db: RawExecutor = prisma,
): Promise<SubtaskAdoptionResult> {
  const statement =
    'UPDATE "Task" SET "workspaceId" = ' +
    '(SELECT p."workspaceId" FROM "Task" AS p WHERE p."id" = "Task"."parentId") ' +
    'WHERE "workspaceId" IS NULL AND "parentId" IS NOT NULL AND EXISTS ' +
    '(SELECT 1 FROM "Task" AS p WHERE p."id" = "Task"."parentId" AND p."workspaceId" IS NOT NULL)';
  let adopted = 0;
  let passes = 0;
  while (passes < MAX_ADOPTION_PASSES) {
    const changed = await db.$executeRawUnsafe(statement);
    passes += 1;
    adopted += changed;
    if (changed === 0) break;
  }
  log.info({ adopted, passes }, 'unowned subtasks adopted their parent workspace');
  return { adopted, passes };
}

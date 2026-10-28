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
export async function claimUnownedRows(workspaceId: number): Promise<BackfillResult> {
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
      const claimed = await prisma.$executeRawUnsafe(
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

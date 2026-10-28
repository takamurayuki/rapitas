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

type UpdateManyDelegate = {
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

/**
 * Hand every unowned row to `workspaceId`.
 *
 * Runs unscoped by necessity: the rows it is looking for are precisely the
 * ones no workspace can see yet.
 *
 * @param workspaceId - The workspace that should own them / 所有させるワークスペース
 * @returns Per-model counts and any failures / モデル別件数と失敗
 */
export async function claimUnownedRows(workspaceId: number): Promise<BackfillResult> {
  return runAcrossAllWorkspaces(async () => {
    const client = prisma as unknown as Record<string, UpdateManyDelegate | undefined>;
    const models: BackfillModelResult[] = [];
    const failed: BackfillModelResult[] = [];

    for (const model of [...getOwnedModels()].sort()) {
      const delegate = client[delegateName(model)];
      if (!delegate || typeof delegate.updateMany !== 'function') {
        // The registry comes from the generated client, so this should be
        // unreachable — but silently skipping a model would leave its rows
        // visible to everyone, which is the one outcome worth shouting about.
        failed.push({ model, claimed: 0, error: 'no updateMany on the client' });
        continue;
      }
      try {
        const { count } = await delegate.updateMany({
          where: { workspaceId: null },
          data: { workspaceId },
        });
        if (count > 0) models.push({ model, claimed: count });
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
  });
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

/**
 * StartupBackfills
 *
 * The one-shot data migrations the backend runs as it warms up, gathered in
 * one place so the next one does not have to be registered in index.ts.
 * That file is 566 lines — past the 500-line limit and pinned on the
 * file-size ratchet baseline — so it cannot grow, and a migration is not a
 * reason to split an entrypoint.
 *
 * Every migration here must be idempotent: this runs on every boot, and a
 * boot with nothing to migrate should cost almost nothing. None of them
 * throws — see each module for how it fails.
 *
 * Order follows the one index.ts had: the workflow files are consolidated by
 * workflow-legacy-migrator before this runs.
 *
 * Not responsible for the migrations themselves — see workflow-db-backfill
 * and rapi-profile-backfill.
 */
import { backfillWorkflowFilesToDatabase } from '../workflow/workflow-db-backfill';
import { backfillRapiProfileToDatabase } from './rapi-profile-backfill';

/**
 * Run every one-shot migration, in order.
 *
 * Sequential rather than concurrent: they both write, and the desktop build
 * is on SQLite, where two writers are one lock contention away from a failed
 * boot-time migration.
 *
 * @returns Rows migrated per step, for the start-up log / 各段で移行した件数
 */
export async function runStartupBackfills(): Promise<Record<string, number>> {
  return {
    workflowFiles: await backfillWorkflowFilesToDatabase(),
    rapiProfile: await backfillRapiProfileToDatabase(),
  };
}

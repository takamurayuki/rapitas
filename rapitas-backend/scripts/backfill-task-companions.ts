#!/usr/bin/env bun
/**
 * backfill-task-companions.ts
 *
 * One-off creation of TaskCompanion rows for tasks ラピ created before the
 * table existed (companion design 4.3, "既存のデータ"). Reads AssistantAction:
 * task.create (executed) by its taskId column, roadmap.commit (executed or
 * failed) by resultJson.taskIds. Done and deleted tasks are skipped, as are
 * tasks that already have a row, so running it twice creates nothing new.
 *
 * DRY RUN BY DEFAULT — it only prints what it would create. Pass `--apply` to
 * write. Run it once, after the server has restarted on the new schema (the
 * table must exist), and only after reading the dry-run output.
 *
 * Usage: bun scripts/backfill-task-companions.ts [--apply]
 *
 * NOTE: With dev.js the live DB is SQLite — run with its URL, e.g.:
 *   RAPITAS_DB_PROVIDER=sqlite DATABASE_URL="file:<repo>/rapitas-desktop/.data/rapitas-dev.db" \
 *     bun scripts/backfill-task-companions.ts
 */
import { prisma } from '../config/database';
import { backfillCompanions, type BackfillDb } from '../services/companion';

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const result = await backfillCompanions(prisma as unknown as BackfillDb, { apply });
  console.log(
    `[companion-backfill] ${apply ? 'APPLY' : 'dry-run'}: ` +
      `to create ${result.create.length}, ` +
      `skipped done ${result.skipped.done.length}, ` +
      `missing ${result.skipped.missing.length}, ` +
      `already tracked ${result.skipped.alreadyTracked.length}`,
  );
  for (const row of result.create) {
    console.log(`  task ${row.taskId} <- ${row.origin} (action ${row.sourceActionId})`);
  }
  if (apply) {
    console.log(`[companion-backfill] created ${result.created}, failed ${result.failed.length}`);
    if (result.failed.length) console.log(`  failed task ids: ${result.failed.join(', ')}`);
  } else {
    console.log('[companion-backfill] nothing written. Re-run with --apply to create these rows.');
  }
}

main()
  .catch((err) => {
    console.error('[companion-backfill] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

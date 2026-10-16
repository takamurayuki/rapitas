#!/usr/bin/env bun
/**
 * cleanup-contradiction-backlog.ts
 *
 * One-shot bulk triage of the open-contradiction backlog (observed: 8,883
 * rows, dominated by near-duplicate lesson paraphrases cross-flagged as
 * "contradictions"). Applies the deterministic rules from
 * contradiction-cleanup.ts in three batched updateMany calls per group and
 * leaves genuinely contested pairs for the nightly LLM drain. Idempotent.
 *
 * Usage: bun scripts/cleanup-contradiction-backlog.ts [--dry-run]
 *
 * NOTE: With dev.js the live DB is SQLite — run with its URL, e.g.:
 *   RAPITAS_DB_PROVIDER=sqlite DATABASE_URL="file:<repo>/rapitas-desktop/.data/rapitas-dev.db" \
 *     bun scripts/cleanup-contradiction-backlog.ts
 */
import { prisma } from '../config/database';
import { decideBulkCleanup } from '../services/memory/contradiction-cleanup';
import { revertOrphanedConflicts } from '../services/memory/contradiction-sweep';

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const rows = await prisma.knowledgeContradiction.findMany({
    where: { resolution: null },
    select: {
      id: true,
      entryA: {
        select: {
          id: true,
          title: true,
          content: true,
          decayScore: true,
          validationStatus: true,
          forgettingStage: true,
        },
      },
      entryB: {
        select: {
          id: true,
          title: true,
          content: true,
          decayScore: true,
          validationStatus: true,
          forgettingStage: true,
        },
      },
    },
  });
  console.log(`[cleanup] ${rows.length} open contradictions loaded${dryRun ? ' (dry-run)' : ''}`);

  const d = decideBulkCleanup(rows);
  console.log(
    `[cleanup] decisions — keep_a: ${d.keepA.length}, keep_b: ${d.keepB.length}, ` +
      `dismiss: ${d.dismiss.length}, entries to reject: ${d.rejectEntryIds.length}, ` +
      `left for nightly LLM drain: ${d.contested.length}`,
  );

  if (dryRun) return;

  const resolvedAt = new Date();
  const CHUNK = 500; // keep IN-lists well under SQLite's variable limit
  const chunks = <T>(xs: T[]) => {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
    return out;
  };

  for (const [ids, resolution] of [
    [d.keepA, 'keep_a'],
    [d.keepB, 'keep_b'],
    [d.dismiss, 'dismiss'],
  ] as const) {
    for (const chunk of chunks(ids)) {
      await prisma.knowledgeContradiction.updateMany({
        where: { id: { in: chunk } },
        data: { resolution, resolvedAt },
      });
    }
  }

  for (const chunk of chunks(d.rejectEntryIds)) {
    await prisma.knowledgeEntry.updateMany({
      where: { id: { in: chunk } },
      data: { validationStatus: 'rejected', forgettingStage: 'archived' },
    });
  }

  const orphans = await revertOrphanedConflicts();
  const remaining = await prisma.knowledgeContradiction.count({ where: { resolution: null } });
  console.log(`[cleanup] done — orphaned conflict entries reverted to pending: ${orphans}`);
  console.log(`[cleanup] open contradictions remaining: ${remaining}`);
}

main()
  .catch((err) => {
    console.error('[cleanup] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

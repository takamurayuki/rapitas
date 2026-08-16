/**
 * backfill-execution-time
 *
 * Backfills AgentExecution.executionTimeMs for terminally-finished rows whose
 * recorded value is missing or under-recorded relative to the wall span
 * (completedAt - startedAt) — the pre-task-#560 error/fallback paths never
 * wrote the field. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   bun run scripts/backfill-execution-time.ts            # dry-run (no writes)
 *   bun run scripts/backfill-execution-time.ts --apply    # write changes
 */
import type { PrismaClient } from '../generated/prisma-postgres';

/**
 * Only under-recording beyond this threshold is repaired. Small gaps are
 * expected by design: executionTimeMs accumulates CLI process segments and
 * legitimately excludes short scheduling/teardown slack inside the wall span.
 */
export const DIVERGENCE_THRESHOLD_MS = 60_000;

/** Terminal statuses eligible for backfill — matches the plan's target set. */
export const TARGET_STATUSES = ['completed', 'failed'] as const;

/** One planned (or applied) row repair. */
export interface BackfillChange {
  id: number;
  before: number | null;
  after: number;
}

/** Summary of a backfill run. */
export interface BackfillSummary {
  scanned: number;
  targets: BackfillChange[];
  applied: number;
}

/** Minimal row shape consumed by the target filter. */
interface CandidateRow {
  id: number;
  startedAt: Date | null;
  completedAt: Date | null;
  executionTimeMs: number | null;
}

/**
 * Decide whether a row needs backfill and compute the fill value.
 *
 * Target condition: terminal row with both timestamps, whose executionTimeMs
 * is null / 0, or under-records the wall span by more than the threshold.
 * Over-recorded rows and rows within the threshold are left untouched — a
 * correct segment-accumulated value must never be clobbered.
 *
 * @param row - Candidate execution row. / 対象候補の実行行
 * @returns Planned change, or null when the row must not be touched. / 修復内容（対象外は null）
 */
export function planBackfill(row: CandidateRow): BackfillChange | null {
  if (!row.startedAt || !row.completedAt) return null;
  const wallMs = row.completedAt.getTime() - row.startedAt.getTime();
  // Negative spans are corrupted rows — skip rather than write garbage.
  if (wallMs < 0) return null;
  const recorded = row.executionTimeMs ?? 0;
  const underRecorded = recorded === 0 || wallMs - recorded > DIVERGENCE_THRESHOLD_MS;
  if (!underRecorded) return null;
  return { id: row.id, before: row.executionTimeMs, after: wallMs };
}

/**
 * Run the backfill over all terminal AgentExecution rows.
 *
 * @param prisma - Prisma client instance. / Prismaクライアント
 * @param opts.apply - Write changes when true; dry-run otherwise. / true で書き込み
 * @returns Run summary (scanned count, targets, applied count). / 実行サマリ
 */
export async function backfillExecutionTime(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<BackfillSummary> {
  const rows = await prisma.agentExecution.findMany({
    where: {
      status: { in: [...TARGET_STATUSES] },
      startedAt: { not: null },
      completedAt: { not: null },
    },
    select: { id: true, startedAt: true, completedAt: true, executionTimeMs: true },
    orderBy: { id: 'asc' },
  });

  const targets: BackfillChange[] = [];
  for (const row of rows) {
    const change = planBackfill(row);
    if (change) targets.push(change);
  }

  let applied = 0;
  if (opts.apply) {
    for (const change of targets) {
      await prisma.agentExecution.update({
        where: { id: change.id },
        data: { executionTimeMs: change.after },
      });
      applied++;
    }
  }

  return { scanned: rows.length, targets, applied };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
// import.meta.main: run only when invoked directly, never on test import.
if (import.meta.main) {
  const apply = process.argv.includes('--apply');
  const { resolvePrismaClientCtor } = await import('../config/prisma-client-resolver');
  const PrismaClientCtor = resolvePrismaClientCtor();
  const prisma = new PrismaClientCtor() as PrismaClient;

  try {
    const summary = await backfillExecutionTime(prisma, { apply });
    console.log(
      `[backfill-execution-time] mode=${apply ? 'APPLY' : 'DRY-RUN'} scanned=${summary.scanned} targets=${summary.targets.length} applied=${summary.applied}`,
    );
    for (const t of summary.targets.slice(0, 20)) {
      console.log(`  id=${t.id}: ${t.before ?? 'null'} → ${t.after}ms`);
    }
    if (summary.targets.length > 20) {
      console.log(`  ... and ${summary.targets.length - 20} more`);
    }
    if (!apply && summary.targets.length > 0) {
      console.log('Re-run with --apply to write these changes.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * CompanionDigestReader
 *
 * Reads what the companion digest needs from the database and moves the
 * "last reported" cursor once a client has shown it. The deciding lives in
 * companion-digest.ts; this file only fetches and writes.
 *
 * No schema change: the cursor is the existing
 * `TaskCompanion.lastDigestTransitionId` (stage 1), the events are
 * `WorkflowTransition` rows, the repair count is repair-escalation's window
 * summary, and the hold reason is the review hold's own record.
 */
import {
  buildCompanionDigest,
  decisionFor,
  type CompanionDigest,
  type DigestCompanionRow,
  type DigestRepairSummary,
  type DigestTaskRow,
  type DigestTransitionRow,
} from './companion-digest';

/** Most transitions one digest read pulls. Newest first, so a flood loses the oldest. */
export const MAX_DIGEST_TRANSITIONS = 1000;

/** The slice of Prisma the reader uses — injectable for tests. */
export interface DigestDb {
  taskCompanion: {
    findMany(args: {
      where: { closedAt: null };
      select: { taskId: true; lastDigestTransitionId: true; startedAt: true };
    }): Promise<DigestCompanionRow[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: { lastDigestTransitionId: number };
    }): Promise<{ count: number }>;
  };
  task: {
    findMany(args: {
      where: { id: { in: number[] } };
      select: Record<keyof DigestTaskRow, true>;
    }): Promise<DigestTaskRow[]>;
  };
  workflowTransition: {
    findMany(args: {
      where: { OR: Record<string, unknown>[] };
      orderBy: { id: 'desc' };
      take: number;
      select: Record<keyof DigestTransitionRow, true>;
    }): Promise<DigestTransitionRow[]>;
  };
}

/** Reads that live in other services, injected so tests need no Prisma. */
export interface DigestDeps {
  summarizeRepairs(taskId: number): Promise<DigestRepairSummary>;
  readHoldReason(taskId: number): Promise<string | null>;
  now?: () => Date;
}

/**
 * Build the digest for every open companion row.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param deps - Repair and hold readers / 修復回数と保留理由の読み手
 * @returns The digest / 要約
 */
export async function readCompanionDigest(
  db: DigestDb,
  deps: DigestDeps,
): Promise<CompanionDigest> {
  const now = deps.now?.() ?? new Date();
  const companions = await db.taskCompanion.findMany({
    where: { closedAt: null },
    select: { taskId: true, lastDigestTransitionId: true, startedAt: true },
  });
  if (companions.length === 0) return buildCompanionDigest(emptyInput(now));

  const ids = companions.map((c) => c.taskId);
  const [tasks, newestFirst] = await Promise.all([
    db.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, status: true, workflowStatus: true, haltReason: true },
    }),
    db.workflowTransition.findMany({
      where: {
        OR: companions.map((c) =>
          c.lastDigestTransitionId != null
            ? { taskId: c.taskId, id: { gt: c.lastDigestTransitionId } }
            : { taskId: c.taskId, createdAt: { gte: new Date(c.startedAt) } },
        ),
      },
      orderBy: { id: 'desc' },
      take: MAX_DIGEST_TRANSITIONS,
      select: {
        id: true,
        taskId: true,
        fromStatus: true,
        toStatus: true,
        cause: true,
        createdAt: true,
        invariantViolation: true,
      },
    }),
  ]);
  const transitions = [...newestFirst].reverse();

  // Only tasks that will be reported need the per-task reads below.
  const withNews = new Set(transitions.map((t) => t.taskId));
  const reported = tasks.filter((t) => withNews.has(t.id) || decisionFor(t) !== null);

  const repairs = new Map<number, DigestRepairSummary>();
  const holdReasons = new Map<number, string>();
  await Promise.all(
    reported.map(async (task) => {
      repairs.set(task.id, await deps.summarizeRepairs(task.id));
      if (decisionFor(task)?.kind === 'review_hold') {
        const reason = await deps.readHoldReason(task.id);
        if (reason) holdReasons.set(task.id, reason);
      }
    }),
  );

  return buildCompanionDigest({ companions, tasks, transitions, repairs, holdReasons, now });
}

function emptyInput(now: Date) {
  return {
    companions: [],
    tasks: [],
    transitions: [],
    repairs: new Map(),
    holdReasons: new Map(),
    now,
  };
}

/** One "I showed the user up to here" report. */
export interface DigestSeenCursor {
  taskId: number;
  transitionId: number;
}

/**
 * Move the cursors forward to what the client showed.
 *
 * Forward only and only on open rows: a stale client reporting an older id
 * cannot rewind the cursor and replay news, and a closed row is history.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param cursors - What the client showed / 表示した位置
 * @returns How many rows moved / 進めた行数
 */
export async function markDigestSeen(db: DigestDb, cursors: DigestSeenCursor[]): Promise<number> {
  let moved = 0;
  for (const { taskId, transitionId } of cursors) {
    const { count } = await db.taskCompanion.updateMany({
      where: {
        taskId,
        closedAt: null,
        OR: [{ lastDigestTransitionId: null }, { lastDigestTransitionId: { lt: transitionId } }],
      },
      data: { lastDigestTransitionId: transitionId },
    });
    moved += count;
  }
  return moved;
}

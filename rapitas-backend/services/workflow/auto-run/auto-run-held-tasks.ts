/**
 * auto-run-held-tasks
 *
 * Enumerates a theme's still-open top-level tasks that selectNextTask can never
 * pick — workflowDisabled, autoRunExcluded, or parked on an intake question — so
 * the dry point reports "done, but N held" instead of a silent "all done".
 * Not responsible for selection itself (auto-run-selection.ts).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';

/** Ids of open tasks the selector skips, grouped by the flag that hides them. */
export interface HeldTaskBreakdown {
  workflowDisabled: number[];
  autoRunExcluded: number[];
  awaitingQuestion: number[];
  total: number;
}

/** Minimal task shape needed to classify a held task. */
export interface HeldTaskRow {
  id: number;
  status: string;
  workflowStatus: string | null;
  workflowDisabled: boolean;
  autoRunExcluded: boolean;
}

/**
 * Group open tasks by the reason the selector skips them. A task hidden by
 * several flags is counted once, under the first reason in field order; rows
 * mid-finalization ('in-progress' with a terminal workflowStatus) mirror the
 * selector and are not held.
 *
 * @param rows - Open top-level tasks of the theme / テーマの未完了トップレベルタスク
 * @returns Ids per hold reason plus the total / 理由別のタスクIDと合計
 */
export function classifyHeldTasks(rows: HeldTaskRow[]): HeldTaskBreakdown {
  const out: HeldTaskBreakdown = {
    workflowDisabled: [],
    autoRunExcluded: [],
    awaitingQuestion: [],
    total: 0,
  };
  for (const row of rows) {
    if (
      row.status === 'in-progress' &&
      (row.workflowStatus === 'completed' || row.workflowStatus === 'verify_done')
    ) {
      continue;
    }
    if (row.workflowDisabled) out.workflowDisabled.push(row.id);
    else if (row.autoRunExcluded) out.autoRunExcluded.push(row.id);
    else if (row.workflowStatus === 'awaiting_question') out.awaitingQuestion.push(row.id);
    else continue;
    out.total++;
  }
  return out;
}

/**
 * Query the theme's open tasks the selector would skip and classify them.
 * Errors resolve to an empty breakdown — observability must never block idling.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme that just ran dry / 枯渇したテーマID
 * @returns Held-task breakdown / 保留タスクの内訳
 */
export async function countHeldTasks(
  prisma: PrismaClient,
  themeId: number,
): Promise<HeldTaskBreakdown> {
  const rows = await prisma.task
    .findMany({
      where: {
        themeId,
        parentId: null,
        status: { in: ['todo', 'in-progress'] },
        OR: [
          { workflowDisabled: true },
          { autoRunExcluded: true },
          { workflowStatus: 'awaiting_question' },
        ],
      },
      select: {
        id: true,
        status: true,
        workflowStatus: true,
        workflowDisabled: true,
        autoRunExcluded: true,
      },
      orderBy: { id: 'asc' },
    })
    .catch(() => [] as HeldTaskRow[]);
  return classifyHeldTasks(rows as HeldTaskRow[]);
}

/**
 * Human-readable summary for logs and the notification, e.g.
 * `#911(workflowDisabled), #907(autoRunExcluded)`.
 *
 * @param held - Breakdown from countHeldTasks / 保留内訳
 * @returns Comma-joined `#id(reason)` list / `#id(理由)` の列挙
 */
export function formatHeldTasks(held: HeldTaskBreakdown): string {
  return [
    ...held.workflowDisabled.map((id) => `#${id}(workflowDisabled)`),
    ...held.autoRunExcluded.map((id) => `#${id}(autoRunExcluded)`),
    ...held.awaitingQuestion.map((id) => `#${id}(awaiting_question)`),
  ].join(', ');
}

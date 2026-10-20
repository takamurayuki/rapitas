/**
 * DeleteFilter
 *
 * Lists the tasks a set of conditions matches, so the user can see exactly
 * what a bulk clear-out would remove before any of it goes.
 *
 * The counterpart to `delete-proposal`, and deliberately the opposite kind of
 * thing. That one asks a model which tasks are redundant, from a window of
 * sixty — judgement, at a scale a prompt can hold. This one asks the
 * database, matches everything, and uses no model at all: measured on the
 * rapitas theme, 719 tasks of which only 10 fell inside the model's window,
 * so for housekeeping at that size a filter is not a worse answer, it is the
 * only correct one.
 *
 * Lists only. The ids it returns go back to the user, who approves them, and
 * the deletion runs against the list they approved — the filter is never
 * evaluated again at delete time, so nothing can match that was not on
 * screen.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const logger = createLogger('assistant-delete-filter');

/**
 * Most rows the preview will hand back.
 *
 * The count is always exact; this caps the list that travels with it. A
 * clear-out of several hundred is normal here, and the user confirms by
 * looking at the conditions and the total, not by reading every row.
 */
export const MAX_PREVIEW_ROWS = 500;

/** Statuses a clear-out may target. Anything else is rejected rather than ignored. */
export const FILTERABLE_STATUSES = ['done', 'cancelled', 'todo', 'in-progress', 'blocked'] as const;

export type FilterableStatus = (typeof FILTERABLE_STATUSES)[number];

export interface DeleteFilterInput {
  themeId?: number;
  statuses?: string[];
  /** Only tasks untouched for at least this long. */
  updatedBeforeDays?: number;
}

/** One task the conditions matched. */
export interface FilterMatch {
  id: number;
  title: string;
  status: string;
  updatedAt: Date;
}

export interface DeleteFilterResult {
  /** Exact number matched, however many rows came back. */
  total: number;
  matches: FilterMatch[];
  /** True when `total` exceeds what the list can carry. */
  truncated: boolean;
  /** Protected tasks are excluded here, so the list cannot promise what the delete will refuse. */
  excludedProtected: number;
}

/**
 * List the tasks a clear-out would remove.
 *
 * Protected tasks are left out: the delete path refuses them anyway, and a
 * preview that includes them promises something it cannot deliver.
 *
 * @param input - The conditions to match / 絞り込み条件
 * @returns The matches, and how many there are in total / 該当タスクと総件数
 */
export async function previewDeleteFilter(input: DeleteFilterInput): Promise<DeleteFilterResult> {
  const statuses = (input.statuses ?? []).filter((s): s is FilterableStatus =>
    (FILTERABLE_STATUSES as readonly string[]).includes(s),
  );

  const where: Record<string, unknown> = { isProtected: false };
  if (typeof input.themeId === 'number') where.themeId = input.themeId;
  if (statuses.length > 0) where.status = { in: statuses };
  if (typeof input.updatedBeforeDays === 'number' && input.updatedBeforeDays > 0) {
    where.updatedAt = { lt: new Date(Date.now() - input.updatedBeforeDays * 24 * 60 * 60 * 1000) };
  }

  const [total, matches, excludedProtected] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: MAX_PREVIEW_ROWS,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
    prisma.task.count({ where: { ...where, isProtected: true } }),
  ]);

  logger.info({ total, returned: matches.length }, 'delete filter previewed');
  return { total, matches, truncated: total > matches.length, excludedProtected };
}

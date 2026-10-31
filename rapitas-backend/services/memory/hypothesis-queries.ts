/**
 * HypothesisQueries
 *
 * Reads over the hypothesis ledger: list, fetch, aggregate counts, plus the
 * manual status and delete overrides.
 * Not responsible for forming a hypothesis or recording evidence — those are
 * writes, and they live in hypothesis-service.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { HypothesisDomain, HypothesisStatus } from './hypothesis-types';
import type { HypothesisEntry } from './hypothesis-row';
import { HYP_SELECT, toHypothesisEntry } from './hypothesis-row';

const log = createLogger('memory:hypothesis');

/**
 * Lists hypotheses with optional filters.
 *
 * @param options - Filters (status/domain/theme) + pagination. / フィルタ
 * @returns Hypotheses and total count. / 仮説リストと総数
 */
export async function listHypotheses(options: {
  status?: HypothesisStatus | 'all';
  domain?: HypothesisDomain;
  themeId?: number;
  /** `'all'` spans every forgetting stage; the default is 'active' only (#1321). */
  stages?: 'all';
  /** Narrow to one task's hypotheses in the query, not in the caller (#1321). */
  originTaskId?: number;
  limit?: number;
  offset?: number;
}): Promise<{ hypotheses: HypothesisEntry[]; total: number }> {
  const { status = 'open', domain, themeId, limit = 20, offset = 0 } = options;

  const where: Record<string, unknown> = { sourceType: 'hypothesis' };
  if (options.stages !== 'all') where.forgettingStage = 'active';
  // NOTE: The column is `taskId`; `originTaskId` is only this layer's name for
  // it (see toHypothesisEntry), so filtering on the exposed name would be an
  // unknown-argument error at query time.
  if (options.originTaskId != null) where.taskId = options.originTaskId;
  if (domain) where.category = domain;
  if (themeId) where.themeId = themeId;
  if (status === 'open') where.validationStatus = 'pending';
  else if (status === 'supported') where.validationStatus = 'validated';
  else if (status === 'refuted') where.validationStatus = 'rejected';
  else if (status === 'inconclusive') where.validationStatus = 'conflict';
  // status === 'all' → no validationStatus filter.

  const [rows, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where,
      // id tiebreak: confidence/updatedAt ties would otherwise leave paginated
      // (skip/take) ordering to DB-implementation whim, so the same page can
      // reshuffle across identical requests.
      orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: offset,
      select: HYP_SELECT,
    }),
    prisma.knowledgeEntry.count({ where }),
  ]);
  return { hypotheses: rows.map(toHypothesisEntry), total };
}

/**
 * Fetches a single hypothesis by id.
 *
 * @param id - Hypothesis id. / 仮説ID
 * @returns The hypothesis, or null when not found. / 仮説、無ければ null
 */
export async function getHypothesis(id: number): Promise<HypothesisEntry | null> {
  const row = await prisma.knowledgeEntry.findFirst({
    where: { id, sourceType: 'hypothesis' },
    select: HYP_SELECT,
  });
  return row ? toHypothesisEntry(row) : null;
}

/**
 * Manually overrides a hypothesis's status (e.g. a human marks it inconclusive).
 *
 * @param id - Hypothesis id. / 仮説ID
 * @param status - New status. / 新しい状態
 * @returns True when updated. / 更新できたか
 */
export async function setHypothesisStatus(id: number, status: HypothesisStatus): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { id, sourceType: 'hypothesis' },
    select: { id: true },
  });
  if (!existing) return false;
  const validationStatus =
    status === 'supported'
      ? 'validated'
      : status === 'refuted'
        ? 'rejected'
        : status === 'inconclusive'
          ? 'conflict'
          : 'pending';
  await prisma.knowledgeEntry.update({
    where: { id },
    data: {
      validationStatus,
      validatedAt: validationStatus === 'pending' ? null : new Date(),
    },
  });
  log.info({ id, status }, 'Hypothesis status manually set');
  return true;
}

/** Deletes a hypothesis. */
export async function deleteHypothesis(id: number): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { id, sourceType: 'hypothesis' },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.knowledgeEntry.delete({ where: { id } });
  return true;
}

/**
 * Counts hypotheses by status (for dashboards / stats).
 *
 * @returns Aggregate counts. / 集計
 */
export async function getHypothesisStats(): Promise<{
  open: number;
  supported: number;
  refuted: number;
  inconclusive: number;
}> {
  // NOTE: No forgettingStage filter (#1321). Graduation consolidates a
  // hypothesis out of 'active', so narrowing to it reported `supported: 0` on
  // a ledger holding 1,509 validated of 2,100 — i.e. "never worked".
  const base = { sourceType: 'hypothesis' as const };
  const [open, supported, refuted, inconclusive] = await Promise.all([
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'pending' } }),
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'validated' } }),
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'rejected' } }),
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'conflict' } }),
  ]);
  return { open, supported, refuted, inconclusive };
}

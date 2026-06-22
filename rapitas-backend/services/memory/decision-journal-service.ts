/**
 * decision-journal-service
 *
 * Manages deliberate decisions recorded by the user. Each entry captures
 * the decision itself, the context behind it, a predicted outcome with a
 * confidence level, and a review date. Later the user can record the
 * actual outcome and calibrate their prediction accuracy over time.
 *
 * Unlike the idea-box / concern-backlog (which use KnowledgeEntry + tags),
 * DecisionLog is a first-class model because review scheduling and
 * calibration stats require structured, indexable columns.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('memory:decision-journal');

/** How accurate the prediction was, recorded at review time. */
export type CalibrationVerdict = 'pending' | 'correct' | 'partial' | 'wrong';
/** Lifecycle of a decision entry. */
export type DecisionStatus = 'open' | 'reviewed' | 'archived';

const VALID_CALIBRATIONS: readonly CalibrationVerdict[] = [
  'pending',
  'correct',
  'partial',
  'wrong',
];
const VALID_STATUSES: readonly DecisionStatus[] = ['open', 'reviewed', 'archived'];

/** Coerces to a valid calibration, defaulting to 'pending'. */
export function normalizeCalibration(value: unknown): CalibrationVerdict {
  return VALID_CALIBRATIONS.includes(value as CalibrationVerdict)
    ? (value as CalibrationVerdict)
    : 'pending';
}

/** Coerces to a valid status, defaulting to 'open'. */
export function normalizeStatus(value: unknown): DecisionStatus {
  return VALID_STATUSES.includes(value as DecisionStatus) ? (value as DecisionStatus) : 'open';
}

export interface DecisionEntry {
  id: number;
  decision: string;
  context: string;
  rationale: string | null;
  predictedOutcome: string;
  confidence: number;
  reviewDate: Date | null;
  actualOutcome: string | null;
  calibration: CalibrationVerdict;
  status: DecisionStatus;
  themeId: number | null;
  taskId: number | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDecisionInput {
  decision: string;
  context: string;
  rationale?: string;
  predictedOutcome: string;
  /** Subjective confidence in the predicted outcome, 0.0–1.0 (default 0.5). */
  confidence?: number;
  reviewDate?: Date;
  themeId?: number;
}

export interface UpdateDecisionInput {
  decision?: string;
  context?: string;
  rationale?: string | null;
  predictedOutcome?: string;
  confidence?: number;
  reviewDate?: Date | null;
  status?: DecisionStatus;
  themeId?: number | null;
}

export interface ReviewInput {
  actualOutcome: string;
  calibration: CalibrationVerdict;
}

/**
 * Creates a new decision entry.
 *
 * @param input - Decision details / 決定の詳細
 * @returns Created DecisionEntry / 作成されたエントリ
 */
export async function createDecision(input: CreateDecisionInput): Promise<DecisionEntry> {
  const entry = await prisma.decisionLog.create({
    data: {
      decision: input.decision,
      context: input.context,
      rationale: input.rationale ?? null,
      predictedOutcome: input.predictedOutcome,
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0.5)),
      reviewDate: input.reviewDate ?? null,
      themeId: input.themeId ?? null,
    },
  });
  log.info({ id: entry.id }, 'Decision created');
  return entry as DecisionEntry;
}

/**
 * Lists decision entries with optional filters and pagination.
 *
 * @param options - Filters + pagination / フィルタ・ページネーション
 * @returns Decision entries and total count / エントリリストと総数
 */
export async function listDecisions(options: {
  status?: DecisionStatus | 'all';
  calibration?: CalibrationVerdict;
  themeId?: number;
  limit?: number;
  offset?: number;
}): Promise<{ decisions: DecisionEntry[]; total: number }> {
  const { status = 'open', calibration, themeId, limit = 20, offset = 0 } = options;

  const where: Record<string, unknown> = {};
  if (status !== 'all') where.status = status;
  if (calibration) where.calibration = calibration;
  if (themeId) where.themeId = themeId;

  const [entries, total] = await Promise.all([
    prisma.decisionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.decisionLog.count({ where }),
  ]);

  return { decisions: entries as DecisionEntry[], total };
}

/**
 * Fetches a single decision by id.
 *
 * @param id - DecisionLog id / 決定ID
 * @returns DecisionEntry or null / エントリまたは null
 */
export async function getDecision(id: number): Promise<DecisionEntry | null> {
  const entry = await prisma.decisionLog.findUnique({ where: { id } });
  return entry as DecisionEntry | null;
}

/**
 * Updates editable fields of a decision.
 *
 * @param id - DecisionLog id / 決定ID
 * @param input - Fields to update / 更新フィールド
 * @returns true on success, false when not found / 成否
 */
export async function updateDecision(id: number, input: UpdateDecisionInput): Promise<boolean> {
  const existing = await prisma.decisionLog.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;

  // Build the update payload only for supplied fields, handling nullable
  // `reviewDate` and `themeId` (undefined = untouched, null = clear).
  const data: Record<string, unknown> = {};
  if (input.decision !== undefined) data.decision = input.decision;
  if (input.context !== undefined) data.context = input.context;
  if ('rationale' in input) data.rationale = input.rationale ?? null;
  if (input.predictedOutcome !== undefined) data.predictedOutcome = input.predictedOutcome;
  if (input.confidence !== undefined) data.confidence = Math.max(0, Math.min(1, input.confidence));
  if ('reviewDate' in input) data.reviewDate = input.reviewDate ?? null;
  if (input.status !== undefined) data.status = input.status;
  if ('themeId' in input) data.themeId = input.themeId ?? null;

  await prisma.decisionLog.update({ where: { id }, data });
  log.info({ id }, 'Decision updated');
  return true;
}

/**
 * Deletes a decision entry.
 *
 * @param id - DecisionLog id / 決定ID
 * @returns true on success, false when not found / 成否
 */
export async function deleteDecision(id: number): Promise<boolean> {
  const existing = await prisma.decisionLog.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.decisionLog.delete({ where: { id } });
  return true;
}

/**
 * Returns open decisions whose review date has arrived (≤ now), ordered by
 * reviewDate ascending so the most overdue appears first.
 *
 * @param limit - Max number of entries to return (default 20) / 最大件数
 * @returns Review-due entries / レビュー期日到来済みエントリ
 */
export async function getReviewDue(limit = 20): Promise<DecisionEntry[]> {
  const now = new Date();
  const entries = await prisma.decisionLog.findMany({
    where: { status: 'open', reviewDate: { lte: now } },
    orderBy: { reviewDate: 'asc' },
    take: limit,
  });
  return entries as DecisionEntry[];
}

/**
 * Records the actual outcome and calibration verdict for a decision, then
 * transitions its status to 'reviewed'.
 *
 * @param id - DecisionLog id / 決定ID
 * @param input - Review data (actual outcome + calibration) / レビュー内容
 * @returns true on success, false when not found / 成否
 */
export async function recordReview(id: number, input: ReviewInput): Promise<boolean> {
  const existing = await prisma.decisionLog.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;

  await prisma.decisionLog.update({
    where: { id },
    data: {
      actualOutcome: input.actualOutcome,
      calibration: normalizeCalibration(input.calibration),
      status: 'reviewed',
      reviewedAt: new Date(),
    },
  });
  log.info({ id, calibration: input.calibration }, 'Decision review recorded');
  return true;
}

/**
 * Calibration accuracy statistics.
 *
 * @returns Aggregate stats / 集計統計
 */
export async function getCalibrationStats(): Promise<{
  total: number;
  reviewed: number;
  accuracy: number;
  byCalibration: Array<{ calibration: string; count: number }>;
}> {
  const [total, reviewed, grouped] = await Promise.all([
    prisma.decisionLog.count(),
    prisma.decisionLog.count({ where: { status: 'reviewed' } }),
    prisma.decisionLog.groupBy({
      by: ['calibration'],
      where: { status: 'reviewed' },
      _count: { id: true },
    }),
  ]);

  const correct = grouped.find((g) => g.calibration === 'correct')?._count.id ?? 0;
  // Avoid division by zero when no reviews yet.
  const accuracy = reviewed > 0 ? correct / reviewed : 0;

  return {
    total,
    reviewed,
    accuracy,
    byCalibration: grouped.map((g) => ({ calibration: g.calibration, count: g._count.id })),
  };
}

/**
 * Resolves the default theme for task conversion (mirrors concern-backlog pattern).
 * Prevents converted tasks from being theme-less and therefore invisible in the
 * category-filtered task list.
 *
 * @returns Default theme id, or null when none is marked default / 既定テーマID
 */
export async function resolveDefaultThemeId(): Promise<number | null> {
  const theme = await prisma.theme.findFirst({ where: { isDefault: true }, select: { id: true } });
  return theme?.id ?? null;
}

// NOTE: convertDecisionToTask removed — a decision is settled knowledge (a
// recorded choice + rationale), not a unit of work. The journal keeps the
// (now-legacy) taskId column for already-converted historical rows, but no new
// conversions are created.

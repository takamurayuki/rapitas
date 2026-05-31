/**
 * concern-backlog-service
 *
 * The "懸念バックログ" (Concern Backlog) — a bug/refactor/risk sibling of the
 * idea box. Agents and users file concerns spotted OUTSIDE the current task's
 * scope instead of fixing them inline; each concern can later be turned into a
 * dedicated task. Backed by KnowledgeEntry (sourceType 'concern'); metadata
 * lives in tags so no schema change is needed.
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createTask } from '../task/task-mutations';

const log = createLogger('memory:concern-backlog');

/** What kind of concern this is. */
export type ConcernType = 'bug' | 'refactor' | 'security' | 'perf' | 'other';
/** How serious / urgent the concern is. */
export type ConcernSeverity = 'urgent' | 'high' | 'medium' | 'low';
/** Lifecycle state of a concern. */
export type ConcernStatus = 'open' | 'task_created' | 'dismissed';

const VALID_TYPES: readonly ConcernType[] = ['bug', 'refactor', 'security', 'perf', 'other'];
const VALID_SEVERITIES: readonly ConcernSeverity[] = ['urgent', 'high', 'medium', 'low'];

/** Coerces an arbitrary value to a valid concern type (default 'bug'). */
export function normalizeConcernType(value: unknown): ConcernType {
  return VALID_TYPES.includes(value as ConcernType) ? (value as ConcernType) : 'bug';
}
/** Coerces an arbitrary value to a valid severity (default 'medium'). */
export function normalizeConcernSeverity(value: unknown): ConcernSeverity {
  return VALID_SEVERITIES.includes(value as ConcernSeverity)
    ? (value as ConcernSeverity)
    : 'medium';
}

/** Severity → numeric weight, used for ordering (higher = surfaces first). */
const SEVERITY_WEIGHT: Record<ConcernSeverity, number> = {
  urgent: 0.95,
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};

export interface ConcernEntry {
  id: number;
  title: string;
  detail: string;
  type: ConcernType;
  severity: ConcernSeverity;
  /** Code location (file / area) the concern refers to, if known. */
  location: string | null;
  status: ConcernStatus;
  /** Task during whose execution the concern was found, if any. */
  originTaskId: number | null;
  /** Task created from this concern, if converted. */
  createdTaskId: number | null;
  themeId: number | null;
  createdAt: Date;
}

export interface SubmitConcernInput {
  title: string;
  detail: string;
  type?: ConcernType;
  severity?: ConcernSeverity;
  location?: string;
  /** Origin: the task being implemented when the concern was spotted. */
  originTaskId?: number;
  themeId?: number;
  /** Origin label: "agent" | "user" | "code_review" | ... */
  source?: string;
}

function contentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Files a concern into the backlog. Deduplicates by title+detail.
 *
 * @param input - Concern details / 懸念の詳細
 * @returns Created (or existing duplicate) KnowledgeEntry id / 作成・既存のID
 */
export async function submitConcern(input: SubmitConcernInput): Promise<number> {
  const type = normalizeConcernType(input.type);
  const severity = normalizeConcernSeverity(input.severity);
  const hash = contentHash(`concern:${input.title}:${input.detail}`);

  const existing = await prisma.knowledgeEntry.findFirst({
    where: { contentHash: hash, sourceType: 'concern' },
    select: { id: true },
  });
  if (existing) {
    log.debug({ id: existing.id }, 'Duplicate concern skipped');
    return existing.id;
  }

  const tags = [`severity:${severity}`];
  if (input.location?.trim()) tags.push(`loc:${input.location.trim()}`);

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: 'concern',
      // sourceId encodes the lifecycle status ('open' | 'task_<id>' | 'dismissed').
      sourceId: 'open',
      title: input.title,
      content: input.detail,
      contentHash: hash,
      // category holds the type so getConcernStats can group by it.
      category: type,
      tags: JSON.stringify(tags),
      confidence: SEVERITY_WEIGHT[severity],
      themeId: input.themeId ?? null,
      taskId: input.originTaskId ?? null,
      forgettingStage: 'active',
      decayScore: 1.0,
      validationStatus: 'pending',
    },
  });

  log.info(
    { id: entry.id, type, severity, originTaskId: input.originTaskId, source: input.source },
    'Concern filed',
  );
  return entry.id;
}

interface ConcernRow {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  sourceId: string | null;
  themeId: number | null;
  taskId: number | null;
  createdAt: Date;
}

/** Maps a KnowledgeEntry row to a ConcernEntry. */
function toConcernEntry(entry: ConcernRow): ConcernEntry {
  const parsedTags = JSON.parse(entry.tags || '[]') as string[];
  const severityTag = parsedTags.find((t) => t.startsWith('severity:'));
  const locTag = parsedTags.find((t) => t.startsWith('loc:'));
  const sourceId = entry.sourceId ?? 'open';
  const taskMatch = sourceId.match(/^task_(\d+)$/);
  const status: ConcernStatus = taskMatch
    ? 'task_created'
    : sourceId === 'dismissed'
      ? 'dismissed'
      : 'open';
  return {
    id: entry.id,
    title: entry.title,
    detail: entry.content,
    type: normalizeConcernType(entry.category),
    severity: normalizeConcernSeverity(severityTag?.slice('severity:'.length)),
    location: locTag ? locTag.slice('loc:'.length) : null,
    status,
    originTaskId: entry.taskId,
    createdTaskId: taskMatch ? parseInt(taskMatch[1]) : null,
    themeId: entry.themeId,
    createdAt: entry.createdAt,
  };
}

const CONCERN_SELECT = {
  id: true,
  title: true,
  content: true,
  category: true,
  tags: true,
  sourceId: true,
  themeId: true,
  taskId: true,
  createdAt: true,
} as const;

/**
 * Lists concerns with optional filtering and pagination.
 *
 * @param options - Filters (status/type/theme) + pagination / フィルタ・ページング
 * @returns Concerns and total count / 懸念リストと総数
 */
export async function listConcerns(options: {
  status?: ConcernStatus | 'all';
  type?: ConcernType;
  severity?: ConcernSeverity;
  themeId?: number;
  limit?: number;
  offset?: number;
}): Promise<{ concerns: ConcernEntry[]; total: number }> {
  const { status = 'open', type, severity, themeId, limit = 20, offset = 0 } = options;

  const where: Record<string, unknown> = { sourceType: 'concern', forgettingStage: 'active' };
  if (type) where.category = type;
  // Severity is stored as a `severity:<level>` tag (always set by submitConcern).
  if (severity) where.tags = { contains: `severity:${severity}` };
  if (themeId) where.themeId = themeId;
  if (status === 'open') where.sourceId = 'open';
  else if (status === 'task_created') where.sourceId = { startsWith: 'task_' };
  else if (status === 'dismissed') where.sourceId = 'dismissed';
  // status === 'all' → no sourceId filter.

  const [entries, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
      select: CONCERN_SELECT,
    }),
    prisma.knowledgeEntry.count({ where }),
  ]);

  return { concerns: entries.map(toConcernEntry), total };
}

/**
 * Updates a concern's status ('dismissed' or back to 'open').
 *
 * @param concernId - Concern id / 懸念ID
 * @param status - New status (dismissed | open) / 新しい状態
 * @returns True when updated / 更新できたか
 */
export async function setConcernStatus(
  concernId: number,
  status: 'dismissed' | 'open',
): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { id: concernId, sourceType: 'concern' },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.knowledgeEntry.update({ where: { id: concernId }, data: { sourceId: status } });
  log.info({ concernId, status }, 'Concern status updated');
  return true;
}

/** Deletes a concern. */
export async function deleteConcern(concernId: number): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { id: concernId, sourceType: 'concern' },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.knowledgeEntry.delete({ where: { id: concernId } });
  return true;
}

/** Severity → task priority. */
const SEVERITY_TO_PRIORITY: Record<ConcernSeverity, 'urgent' | 'high' | 'medium' | 'low'> = {
  urgent: 'urgent',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/** Type → task title prefix. */
const TYPE_PREFIX: Record<ConcernType, string> = {
  bug: '[Bug]',
  refactor: '[Refactor]',
  security: '[Security]',
  perf: '[Perf]',
  other: '[Concern]',
};

/**
 * Converts a concern into a dedicated task (deterministically, no AI), then
 * marks the concern as task_created.
 *
 * @param concernId - Concern id / 懸念ID
 * @returns Created task id, or null on failure / 作成タスクID
 */
export async function convertConcernToTask(concernId: number): Promise<number | null> {
  const row = await prisma.knowledgeEntry.findFirst({
    where: { id: concernId, sourceType: 'concern' },
    select: CONCERN_SELECT,
  });
  if (!row) return null;
  const concern = toConcernEntry(row);
  if (concern.status === 'task_created') {
    throw new Error('この懸念は既にタスク化されています');
  }

  const descriptionParts = [concern.detail];
  if (concern.location) descriptionParts.push(`\n対象箇所: ${concern.location}`);
  if (concern.originTaskId) descriptionParts.push(`発見元タスク: #${concern.originTaskId}`);
  descriptionParts.push(`種別: ${concern.type} / 重大度: ${concern.severity}`);

  const task = await createTask(prisma, {
    title: `${TYPE_PREFIX[concern.type]} ${concern.title}`.slice(0, 200),
    description: descriptionParts.join('\n'),
    priority: SEVERITY_TO_PRIORITY[concern.severity],
    status: 'todo',
    themeId: concern.themeId ?? undefined,
  });
  if (!task) return null;

  await prisma.knowledgeEntry.update({
    where: { id: concernId },
    data: { sourceId: `task_${task.id}` },
  });
  log.info({ concernId, taskId: task.id }, 'Concern converted to task');
  return task.id;
}

/**
 * Concern counts by status and type.
 *
 * @returns Aggregate stats / 集計統計
 */
export async function getConcernStats(): Promise<{
  open: number;
  taskCreated: number;
  dismissed: number;
  byType: Array<{ type: string; count: number }>;
}> {
  const base = { sourceType: 'concern' as const, forgettingStage: 'active' };
  const [open, taskCreated, dismissed, grouped] = await Promise.all([
    prisma.knowledgeEntry.count({ where: { ...base, sourceId: 'open' } }),
    prisma.knowledgeEntry.count({ where: { ...base, sourceId: { startsWith: 'task_' } } }),
    prisma.knowledgeEntry.count({ where: { ...base, sourceId: 'dismissed' } }),
    prisma.knowledgeEntry.groupBy({
      by: ['category'],
      where: { ...base, sourceId: 'open' },
      _count: { id: true },
    }),
  ]);
  return {
    open,
    taskCreated,
    dismissed,
    byType: grouped.map((g) => ({ type: g.category, count: g._count.id })),
  };
}

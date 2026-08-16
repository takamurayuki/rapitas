/**
 * detection-miss-ledger
 *
 * Records quality-gate slip-throughs (misses) discovered AFTER a task passed
 * its gates, with verifiable evidence per case (task #578). Pure extraction
 * core + a thin DB layer; detection only — never repairs state and never
 * files tasks. NOT responsible for suggesting countermeasures (see
 * miss-signature-suggester.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('self-improvement:miss-ledger');

/** Gates a defect can slip past. */
export type MissGate = 'ci_repair' | 'post_completion_concern';

/**
 * Concern sources accepted as post-completion defect discovery. Precision
 * over recall: automated PROCESS reviewers (process_retro, self_incident_watch,
 * loop_review, …) file concerns about workflow friction right after completion
 * by design — counting those would flood the ledger with false misses. Only a
 * human or a later agent/code review reporting an actual defect qualifies.
 */
export const POST_COMPLETION_MISS_SOURCES: ReadonlySet<string> = new Set([
  'user',
  'agent',
  'code_review',
]);

/** A WorkflowTransition row as the extractor consumes it. */
export interface TransitionEvidenceRow {
  id: number;
  taskId: number;
  cause: string | null;
  metadata: string | null;
  createdAt: Date;
}

/** A concern (KnowledgeEntry sourceType='concern') as the extractor consumes it. */
export interface ConcernEvidenceRow {
  id: number;
  originTaskId: number | null;
  title: string;
  /** Origin label parsed from the `source:` tag ('unknown' when absent). */
  source: string;
  createdAt: Date;
}

/** Origin-task snapshot needed to decide "was it already completed". */
export interface OriginTaskRow {
  id: number;
  status: string;
  completedAt: Date | null;
}

/** One extracted miss case, ready for recording. */
export interface MissCandidate {
  taskId: number;
  gate: MissGate;
  reason: string;
  evidenceJson: string;
  detectedAt: Date;
  dedupKey: string;
}

/** Parsed subset of a ci_repair transition's metadata JSON. */
interface CiRepairMetadata {
  failedChecks?: unknown;
  attempt?: unknown;
  headSha?: unknown;
  logRef?: unknown;
  prNumber?: unknown;
}

function parseMetadata(raw: string | null): CiRepairMetadata {
  try {
    const parsed = JSON.parse(raw ?? '{}');
    return parsed !== null && typeof parsed === 'object' ? (parsed as CiRepairMetadata) : {};
  } catch {
    return {};
  }
}

function toCiRepairCase(row: TransitionEvidenceRow): MissCandidate {
  const meta = parseMetadata(row.metadata);
  const failedChecks = Array.isArray(meta.failedChecks)
    ? meta.failedChecks.filter((c): c is string => typeof c === 'string')
    : [];
  const evidence = {
    transitionId: row.id,
    occurredAt: row.createdAt.toISOString(),
    failedChecks,
    headSha: typeof meta.headSha === 'string' ? meta.headSha : null,
    // NOTE: ci_repair transition metadata carries failedChecks/attempt/headSha
    // but NO log lines and NO PR number (ci-self-repair.ts records only those
    // fields; the log excerpt goes into verify.md). Recorded honestly as
    // unavailable instead of fabricated — acceptance is "obtainable evidence".
    logRef: typeof meta.logRef === 'string' ? meta.logRef : 'unavailable',
    prNumber: typeof meta.prNumber === 'number' ? meta.prNumber : null,
  };
  return {
    taskId: row.taskId,
    gate: 'ci_repair',
    reason: `verify通過後にCIが失敗: ${failedChecks.join(', ') || '(チェック名不明)'}`,
    evidenceJson: JSON.stringify(evidence),
    detectedAt: row.createdAt,
    dedupKey: `miss:ci_repair:${row.taskId}:${row.id}`,
  };
}

function toPostCompletionCase(concern: ConcernEvidenceRow, task: OriginTaskRow): MissCandidate {
  const evidence = {
    concernId: concern.id,
    occurredAt: concern.createdAt.toISOString(),
    taskCompletedAt: task.completedAt?.toISOString() ?? null,
    source: concern.source,
    logRef: 'unavailable',
  };
  return {
    taskId: task.id,
    gate: 'post_completion_concern',
    reason: `完了後に懸念が起票: ${concern.title}`,
    evidenceJson: JSON.stringify(evidence),
    detectedAt: concern.createdAt,
    dedupKey: `miss:post_completion_concern:${task.id}:${concern.id}`,
  };
}

/**
 * Extract miss cases from raw evidence rows. Pure — the testable core.
 *
 * Deliberately NARROW (precision over recall, the user's top priority):
 * - `ci_repair` transitions qualify (verify passed, CI then caught the defect).
 * - `verify_repair` (incl. diff_review) does NOT — the gate caught it BEFORE
 *   completion, i.e. the system worked; counting it would poison the ledger
 *   with false misses.
 * - A concern qualifies only when its origin task was ALREADY completed
 *   (completedAt recorded and ≤ the concern's filing time) AND its source is
 *   in {@link POST_COMPLETION_MISS_SOURCES}. Missing completedAt → not a miss.
 *
 * @param input.transitions - Transition rows (any causes). / 遷移行
 * @param input.concerns - Concern rows with parsed source. / 懸念行
 * @param input.tasksById - Origin-task snapshots. / 起点タスクの状態
 * @returns Extracted candidates (possibly empty). / 抽出された事例
 */
export function extractMissCases(input: {
  transitions: TransitionEvidenceRow[];
  concerns: ConcernEvidenceRow[];
  tasksById: Map<number, OriginTaskRow>;
}): MissCandidate[] {
  const out: MissCandidate[] = [];

  for (const row of input.transitions) {
    if (row.cause !== 'ci_repair') continue;
    out.push(toCiRepairCase(row));
  }

  for (const concern of input.concerns) {
    if (concern.originTaskId === null) continue;
    if (!POST_COMPLETION_MISS_SOURCES.has(concern.source)) continue;
    const task = input.tasksById.get(concern.originTaskId);
    if (!task || task.status !== 'completed') continue;
    // No completedAt → cannot prove the defect surfaced AFTER completion; the
    // task may have completed after the concern was filed. Precision-first: skip.
    if (task.completedAt === null) continue;
    if (task.completedAt.getTime() > concern.createdAt.getTime()) continue;
    out.push(toPostCompletionCase(concern, task));
  }

  return out;
}

/**
 * Persist extracted cases. Duplicate dedupKeys (re-scans of the same evidence)
 * are swallowed silently; other DB errors are logged and skipped (fail-open —
 * the ledger must never break its caller).
 *
 * @param candidates - Cases to record. / 記録する事例
 * @returns Number of NEW rows created. / 新規作成件数
 */
export async function recordMissCases(candidates: MissCandidate[]): Promise<number> {
  let created = 0;
  for (const candidate of candidates) {
    try {
      // NOTE: prisma.detectionMissCase requires the regenerated client — dev.js
      // regenerates on the post-merge server restart (never run generate manually).
      await prisma.detectionMissCase.create({ data: candidate });
      created++;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // P2002 = unique constraint (dedupKey) — an already-recorded case.
      if (code !== 'P2002') {
        log.warn({ err, dedupKey: candidate.dedupKey }, '[miss-ledger] case insert failed');
      }
    }
  }
  return created;
}

/** Extracts the `source:` tag value from a concern's serialized tags. */
function parseSourceTag(tags: string): string {
  try {
    const parsed = JSON.parse(tags || '[]') as string[];
    const tag = parsed.find((t) => typeof t === 'string' && t.startsWith('source:'));
    return tag ? tag.slice('source:'.length) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Gather evidence rows from the DB and record every extracted miss case.
 * Read-only over WorkflowTransition/KnowledgeEntry/Task; writes only to the
 * DetectionMissCase ledger. Fail-open on query errors.
 *
 * @param opts.nowMs - Anchor time (injectable for tests). / 基準時刻
 * @param opts.lookbackDays - Evidence window (default 30). / 遡り日数
 * @returns Number of newly recorded cases. / 新規記録件数
 */
export async function collectAndRecordMissCases(
  opts: { nowMs?: number; lookbackDays?: number } = {},
): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const lookbackDays =
    opts.lookbackDays ??
    (parseInt(process.env.RAPITAS_MISS_LOOKBACK_DAYS ?? '', 10) > 0
      ? parseInt(process.env.RAPITAS_MISS_LOOKBACK_DAYS ?? '', 10)
      : 30);
  const since = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000);

  const transitions: TransitionEvidenceRow[] = await prisma.workflowTransition
    .findMany({
      where: { cause: 'ci_repair', createdAt: { gte: since } },
      select: { id: true, taskId: true, cause: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    .catch(() => []);

  const concernRows = await prisma.knowledgeEntry
    .findMany({
      where: { sourceType: 'concern', createdAt: { gte: since }, taskId: { not: null } },
      select: { id: true, taskId: true, title: true, tags: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    .catch(
      () =>
        [] as { id: number; taskId: number | null; title: string; tags: string; createdAt: Date }[],
    );

  const concerns: ConcernEvidenceRow[] = concernRows.map((row) => ({
    id: row.id,
    originTaskId: row.taskId,
    title: row.title,
    source: parseSourceTag(row.tags),
    createdAt: row.createdAt,
  }));

  const taskIds = [...new Set(concerns.map((c) => c.originTaskId).filter((id) => id !== null))];
  const taskRows: OriginTaskRow[] =
    taskIds.length > 0
      ? await prisma.task
          .findMany({
            where: { id: { in: taskIds } },
            select: { id: true, status: true, completedAt: true },
          })
          .catch(() => [])
      : [];
  const tasksById = new Map(taskRows.map((t) => [t.id, t]));

  const candidates = extractMissCases({ transitions, concerns, tasksById });
  return recordMissCases(candidates);
}

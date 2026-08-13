/**
 * Growth Ledger Metrics
 *
 * Weekly self-growth ledger for the /agents/growth dashboard: computes the
 * five "is the system getting smarter" series (autonomous completion rate,
 * critic first-pass rate, repair efficiency, defect recurrence rate, KB
 * validated ratio) from the append-only WorkflowTransition log and
 * KnowledgeEntry rows. Read-only aggregation over existing columns — not
 * responsible for recording anything new (bounce counting per cause lives in
 * loop-metrics.ts; this module complements it with per-task ratios).
 */
import { prisma } from '../../config/database';

/** A WorkflowTransition row as the grouping core consumes it. */
export interface GrowthTransitionRow {
  taskId: number;
  toStatus: string | null;
  actor: string;
  cause: string | null;
  metadata: string | null;
  createdAt: Date;
}

/** Per-task lifecycle summary distilled from its full transition history. */
export interface TaskEventLite {
  taskId: number;
  /** First `toStatus='completed'` transition time; null when never completed. */
  completedAt: Date | null;
  /** True when any transition was driven by `actor='user'` (manual intervention). */
  hadUserActor: boolean;
  verifyRepairCount: number;
  ciRepairCount: number;
  /** First `file_saved:research` transition time; null when never saved. */
  researchSavedAt: Date | null;
  /** True when research hit `research_critic_failed` / `research_critic_exhausted`. */
  researchBounced: boolean;
  /** First `file_saved:plan` transition time; null when never saved. */
  planSavedAt: Date | null;
  /** True when plan hit `plan_critic_failed` / `plan_critic_exhausted`. */
  planBounced: boolean;
}

/** Concern lifecycle status decoded from KnowledgeEntry.sourceId. */
export type ConcernStatusLite = 'open' | 'dismissed' | 'resolved' | 'task_created';

/** A concern row as the recurrence metric consumes it. */
export interface ConcernLite {
  /** Normalized location key; null when the concern carries no location. */
  key: string | null;
  status: ConcernStatusLite;
  createdAt: Date;
}

/** A KB entry as the validated-ratio metric consumes it. */
export interface KbLite {
  createdAt: Date;
  validatedAt: Date | null;
}

/** Input bundle for the pure aggregation core. */
export interface GrowthLedgerInput {
  taskEvents: TaskEventLite[];
  concerns: ConcernLite[];
  kbEntries: KbLite[];
}

/** One window of the growth ledger (shape of the /agent-metrics/growth-ledger contract). */
export interface GrowthLedgerWindow {
  /** Inclusive window start (ISO). */
  from: string;
  /** Exclusive window end (ISO). */
  to: string;
  autonomy: { completed: number; autonomous: number; rate: number | null };
  criticFirstPass: {
    research: { total: number; firstPass: number; rate: number | null };
    plan: { total: number; firstPass: number; rate: number | null };
  };
  repairEfficiency: { completedTasks: number; totalRepairs: number; avgPerTask: number | null };
  defectRecurrence: { newConcerns: number; recurring: number; rate: number | null };
  kbQuality: { total: number; validated: number; rate: number | null };
}

export interface GrowthLedger {
  windowDays: number;
  /** Newest window FIRST. */
  windows: GrowthLedgerWindow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Explicit include list (not an exclusion) so future sourceTypes (ledger-like
// rows such as concern/idea_box/hypothesis) never silently pollute metric 5.
const KB_SOURCETYPES = [
  'agent_execution',
  'user_learning',
  'task_pattern',
  'distilled_procedure',
  'consolidated',
] as const;

/** Concern statuses treated as terminal (closed) for recurrence detection. */
const TERMINAL_CONCERN_STATUSES: ReadonlySet<ConcernStatusLite> = new Set([
  'dismissed',
  'resolved',
  'task_created',
]);

/** Transition causes that anchor a task into the analysis range. */
const SAVE_CAUSES = ['file_saved:research', 'file_saved:plan'] as const;

// NOTE: `loc:` is the prefix the production writer emits (submitConcern,
// concern-backlog-service.ts:202 `tags.push(`loc:${...}`)`). The long-form
// `location:` is tolerated defensively so a future writer using the
// documented long form still feeds metric 4. Order matters only for
// readability — the two prefixes cannot match the same tag.
const LOCATION_TAG_PREFIXES = ['loc:', 'location:'] as const;

/**
 * Normalizes a concern location into a recurrence key: strips trailing
 * `:line(:col)` suffixes, trims, lowercases. Line-level differences must
 * collapse to one key so "the same place resurfaced" is detected.
 *
 * @param location - Raw concern location (`path/to/file.ts:42` etc.) / 懸念のlocation生値
 * @returns Normalized key, or null when no usable location remains. / 正規化キー（無ければnull）
 */
export function normalizeConcernKey(location: string | null | undefined): string | null {
  if (!location) return null;
  const key = location
    .trim()
    .replace(/(?::\d+)+$/, '')
    .trim()
    .toLowerCase();
  return key.length > 0 ? key : null;
}

/**
 * Collapses raw transition rows into one lifecycle summary per task. Pure —
 * the first half of the testable core.
 *
 * @param rows - Transition rows (any order, full history per task). / 対象遷移行
 * @returns One TaskEventLite per distinct taskId. / タスク毎の集約
 */
export function groupTaskEvents(rows: GrowthTransitionRow[]): TaskEventLite[] {
  const byTask = new Map<number, TaskEventLite>();
  for (const row of rows) {
    let ev = byTask.get(row.taskId);
    if (!ev) {
      ev = {
        taskId: row.taskId,
        completedAt: null,
        hadUserActor: false,
        verifyRepairCount: 0,
        ciRepairCount: 0,
        researchSavedAt: null,
        researchBounced: false,
        planSavedAt: null,
        planBounced: false,
      };
      byTask.set(row.taskId, ev);
    }
    // First completion wins: a re-opened & re-completed task stays attributed
    // to the week it first completed so it never lands in two windows.
    if (row.toStatus === 'completed' && (!ev.completedAt || row.createdAt < ev.completedAt)) {
      ev.completedAt = row.createdAt;
    }
    if (row.actor === 'user') ev.hadUserActor = true;
    switch (row.cause) {
      case 'verify_repair':
        ev.verifyRepairCount++;
        break;
      case 'ci_repair':
        ev.ciRepairCount++;
        break;
      case 'file_saved:research':
        // First save wins: first-pass attribution belongs to the attempt week.
        if (!ev.researchSavedAt || row.createdAt < ev.researchSavedAt) {
          ev.researchSavedAt = row.createdAt;
        }
        break;
      case 'file_saved:plan':
        if (!ev.planSavedAt || row.createdAt < ev.planSavedAt) {
          ev.planSavedAt = row.createdAt;
        }
        break;
      case 'research_critic_failed':
      case 'research_critic_exhausted':
        ev.researchBounced = true;
        break;
      case 'plan_critic_failed':
      case 'plan_critic_exhausted':
        ev.planBounced = true;
        break;
      default:
        break;
    }
  }
  return Array.from(byTask.values());
}

/**
 * Computes the five growth series over rolling windows counting back from
 * `now`. Pure — the second half of the testable core. Window boundary math
 * mirrors bucketTransitions (loop-metrics.ts): future rows (`age<0`) are
 * excluded, `from` inclusive / `to` exclusive, `floor(age/windowMs)` indexing.
 *
 * @param input - Task summaries, concerns, and KB entries. / 集計入力
 * @param now - Window anchor (newest window ends here). / 窓の基準時刻
 * @param windowDays - Days per window. / 窓の日数
 * @param windowCount - Number of windows. / 窓の数
 * @returns Windows, newest first; empty denominators yield `rate`/`avgPerTask`=null. / 新しい順の窓
 */
export function computeGrowthLedger(
  input: GrowthLedgerInput,
  now: Date,
  windowDays: number,
  windowCount: number,
): GrowthLedgerWindow[] {
  const windowMs = windowDays * DAY_MS;
  const nowMs = now.getTime();

  const indexOf = (at: Date): number => {
    const age = nowMs - at.getTime();
    if (age < 0 || age >= windowMs * windowCount) return -1;
    return Math.floor(age / windowMs);
  };

  const windows: GrowthLedgerWindow[] = [];
  for (let i = 0; i < windowCount; i++) {
    const to = new Date(nowMs - i * windowMs);
    const from = new Date(to.getTime() - windowMs);
    windows.push({
      from: from.toISOString(),
      to: to.toISOString(),
      autonomy: { completed: 0, autonomous: 0, rate: null },
      criticFirstPass: {
        research: { total: 0, firstPass: 0, rate: null },
        plan: { total: 0, firstPass: 0, rate: null },
      },
      repairEfficiency: { completedTasks: 0, totalRepairs: 0, avgPerTask: null },
      defectRecurrence: { newConcerns: 0, recurring: 0, rate: null },
      kbQuality: { total: 0, validated: 0, rate: null },
    });
  }

  for (const ev of input.taskEvents) {
    if (ev.completedAt) {
      const idx = indexOf(ev.completedAt);
      if (idx >= 0) {
        const w = windows[idx]!;
        w.autonomy.completed++;
        if (!ev.hadUserActor) w.autonomy.autonomous++;
        w.repairEfficiency.completedTasks++;
        w.repairEfficiency.totalRepairs += ev.verifyRepairCount + ev.ciRepairCount;
      }
    }
    if (ev.researchSavedAt) {
      const idx = indexOf(ev.researchSavedAt);
      if (idx >= 0) {
        const s = windows[idx]!.criticFirstPass.research;
        s.total++;
        if (!ev.researchBounced) s.firstPass++;
      }
    }
    if (ev.planSavedAt) {
      const idx = indexOf(ev.planSavedAt);
      if (idx >= 0) {
        const s = windows[idx]!.criticFirstPass.plan;
        s.total++;
        if (!ev.planBounced) s.firstPass++;
      }
    }
  }

  // Recurrence: a keyed concern recurs when a CLOSED concern at the same key
  // predates the candidate's window start. Earliest terminal time per key is
  // enough — the candidate itself (createdAt >= window.from) can never match.
  const earliestTerminalByKey = new Map<string, number>();
  for (const c of input.concerns) {
    if (!c.key || !TERMINAL_CONCERN_STATUSES.has(c.status)) continue;
    const t = c.createdAt.getTime();
    const prev = earliestTerminalByKey.get(c.key);
    if (prev === undefined || t < prev) earliestTerminalByKey.set(c.key, t);
  }
  for (const c of input.concerns) {
    if (!c.key) continue; // Keyless concerns are excluded from BOTH numerator and denominator.
    const idx = indexOf(c.createdAt);
    if (idx < 0) continue;
    const w = windows[idx]!;
    w.defectRecurrence.newConcerns++;
    const fromMs = nowMs - (idx + 1) * windowMs;
    const earliest = earliestTerminalByKey.get(c.key);
    if (earliest !== undefined && earliest < fromMs) w.defectRecurrence.recurring++;
  }

  // KB quality is a point-in-time cumulative snapshot at each window's end —
  // a validatedAt later than window.to must not lift past weeks' ratios.
  for (let i = 0; i < windowCount; i++) {
    const toMs = nowMs - i * windowMs;
    const q = windows[i]!.kbQuality;
    for (const kb of input.kbEntries) {
      if (kb.createdAt.getTime() > toMs) continue;
      q.total++;
      if (kb.validatedAt && kb.validatedAt.getTime() <= toMs) q.validated++;
    }
  }

  for (const w of windows) {
    w.autonomy.rate =
      w.autonomy.completed > 0 ? w.autonomy.autonomous / w.autonomy.completed : null;
    const r = w.criticFirstPass.research;
    r.rate = r.total > 0 ? r.firstPass / r.total : null;
    const p = w.criticFirstPass.plan;
    p.rate = p.total > 0 ? p.firstPass / p.total : null;
    w.repairEfficiency.avgPerTask =
      w.repairEfficiency.completedTasks > 0
        ? w.repairEfficiency.totalRepairs / w.repairEfficiency.completedTasks
        : null;
    w.defectRecurrence.rate =
      w.defectRecurrence.newConcerns > 0
        ? w.defectRecurrence.recurring / w.defectRecurrence.newConcerns
        : null;
    w.kbQuality.rate = w.kbQuality.total > 0 ? w.kbQuality.validated / w.kbQuality.total : null;
  }
  return windows;
}

/**
 * Decodes the concern lifecycle status encoded in KnowledgeEntry.sourceId
 * (same convention as listConcerns in concern-backlog-service.ts).
 *
 * @param sourceId - Raw KnowledgeEntry.sourceId value / 懸念行のsourceId生値
 * @returns Concern lifecycle status; unknown values fall back to `open`. / 懸念の状態
 */
export function decodeConcernStatus(sourceId: string | null): ConcernStatusLite {
  if (sourceId === 'dismissed') return 'dismissed';
  if (sourceId === 'resolved') return 'resolved';
  if (sourceId?.startsWith('task_')) return 'task_created';
  return 'open';
}

/**
 * Extracts the raw location from a concern's tags JSON (a stringified string
 * array; the location entry is prefixed — see LOCATION_TAG_PREFIXES).
 *
 * @param tagsJson - Raw KnowledgeEntry.tags JSON string / 懸念行のtags生JSON
 * @returns Raw location value, or null when absent or malformed. / location生値（無ければnull）
 */
export function extractLocation(tagsJson: string): string | null {
  try {
    const tags = JSON.parse(tagsJson) as unknown;
    if (!Array.isArray(tags)) return null;
    for (const prefix of LOCATION_TAG_PREFIXES) {
      const hit = tags.find((t): t is string => typeof t === 'string' && t.startsWith(prefix));
      if (hit) return hit.slice(prefix.length);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Loads the raw rows and delegates to the pure core. Read-only — four Prisma
 * queries, no writes.
 *
 * @param opts.windowDays - Days per window (default 7). / 窓の日数
 * @param opts.windowCount - Number of windows (default 12). / 窓の数
 * @param opts.now - Anchor time, injectable for tests. / 基準時刻
 * @returns Weekly growth ledger, newest window first. / 新しい順の成長台帳
 */
export async function computeGrowthLedgerMetrics(
  opts: { windowDays?: number; windowCount?: number; now?: Date } = {},
): Promise<GrowthLedger> {
  const windowDays = opts.windowDays ?? 7;
  const windowCount = opts.windowCount ?? 12;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * windowCount * DAY_MS);

  // Two-stage fetch: (1) which tasks have an anchoring event in range, then
  // (2) those tasks' FULL transition history — a critic bounce or user
  // intervention outside the range must still flag the task (§plan: 2段クエリ).
  const anchors = await prisma.workflowTransition.findMany({
    where: {
      createdAt: { gte: since },
      OR: [{ toStatus: 'completed' }, { cause: { in: [...SAVE_CAUSES] } }],
    },
    select: { taskId: true },
    distinct: ['taskId'],
  });
  const taskIds = anchors.map((a) => a.taskId);

  const transitions: GrowthTransitionRow[] = taskIds.length
    ? await prisma.workflowTransition.findMany({
        where: { taskId: { in: taskIds } },
        select: {
          taskId: true,
          toStatus: true,
          actor: true,
          cause: true,
          metadata: true,
          createdAt: true,
        },
      })
    : [];

  // No lower bound on concerns: recurrence needs closed concerns that may
  // predate the analysis range (§metric4 — prior must exist before window start).
  const concernRows = await prisma.knowledgeEntry.findMany({
    where: { sourceType: 'concern', createdAt: { lte: now } },
    select: { sourceId: true, tags: true, createdAt: true },
  });

  const kbRows = await prisma.knowledgeEntry.findMany({
    where: { sourceType: { in: [...KB_SOURCETYPES] }, createdAt: { lte: now } },
    select: { createdAt: true, validatedAt: true },
  });

  const input: GrowthLedgerInput = {
    taskEvents: groupTaskEvents(transitions),
    concerns: concernRows.map((c) => ({
      key: normalizeConcernKey(extractLocation(c.tags)),
      status: decodeConcernStatus(c.sourceId),
      createdAt: c.createdAt,
    })),
    kbEntries: kbRows.map((k) => ({ createdAt: k.createdAt, validatedAt: k.validatedAt })),
  };

  return { windowDays, windows: computeGrowthLedger(input, now, windowDays, windowCount) };
}

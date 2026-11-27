/**
 * recheck-state
 *
 * State of the implementer re-check for companions selected without a plan
 * (task 1572): the WorkflowTransition causes used as the durable mark and
 * reason log, the "planless candidate" predicate, the mark readers / writers,
 * the hold signature and the in-memory hold table the tenure wall reads.
 * Static imports are types only, so the tenure guard can import this without
 * pulling the DB client in. Not responsible for judging overlaps.
 */

/** Written at companion selection: the task must be re-checked before implementing. */
export const RECHECK_PENDING_CAUSE = 'parallel_recheck_pending';
/** Written when the gate holds the implementer and the reason changed. */
export const RECHECK_HELD_CAUSE = 'parallel_recheck_held';
/** Written when the gate let the implementer through; consumes the mark. */
export const RECHECK_PASSED_CAUSE = 'parallel_recheck_passed';

/** Workflow states that carry no plan yet and change no files (null = never started). */
const PLANLESS_WORKFLOW_STATUSES: ReadonlyArray<string> = ['draft', 'research_done'];

/**
 * Whether a candidate may be taken as a companion without a plan.
 *
 * NOTE: `in_progress` without a plan stays refused — it may carry a partial
 * implementation, so running it next to another task can collide on files.
 *
 * @param workflowStatus - Task.workflowStatus / ワークフロー状態
 * @param hasPlanFiles - Whether its plan names any comparable file / 計画にファイルがあるか
 * @returns True when the candidate is planless and has not started implementing / 計画なし候補なら true
 */
export function isPlanlessCandidate(
  workflowStatus: string | null | undefined,
  hasPlanFiles: boolean,
): boolean {
  if (hasPlanFiles) return false;
  return workflowStatus == null || PLANLESS_WORKFLOW_STATUSES.includes(workflowStatus);
}

/** Row shape the readers need. */
interface TransitionRow {
  cause: string | null;
  createdAt: Date;
  metadata?: string | null;
}

/** The WorkflowTransition model slice used here (loose so partial mocks type-check). */
interface TransitionModel {
  create?: (args: unknown) => Promise<unknown>;
  findMany?: (args: unknown) => Promise<TransitionRow[]>;
  findFirst?: (args: unknown) => Promise<TransitionRow | null>;
}

/** Any client exposing `workflowTransition`. */
export interface RecheckPrisma {
  workflowTransition?: TransitionModel;
}

const model = (prisma: unknown): TransitionModel =>
  (prisma as RecheckPrisma | null)?.workflowTransition ?? {};

/**
 * Write the pending mark. Throws on failure so selection can refuse the slot.
 *
 * NOTE: not recordTransition — it swallows write errors, and a missing mark
 * would let the companion reach the implementer without the re-check.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param input - Task, theme and its workflow status / 対象
 * @throws {Error} When the model is missing or the write fails / 書き込み失敗時
 */
export async function writePendingMark(
  prisma: unknown,
  input: { taskId: number; themeId: number; workflowStatus: string | null },
): Promise<void> {
  const m = model(prisma);
  if (typeof m.create !== 'function') throw new Error('workflowTransition.create unavailable');
  const status = input.workflowStatus ?? 'draft';
  await m.create({
    data: {
      taskId: input.taskId,
      fromStatus: status,
      toStatus: status,
      actor: 'system',
      cause: RECHECK_PENDING_CAUSE,
      metadata: JSON.stringify({
        themeId: input.themeId,
        workflowStatus: input.workflowStatus,
        reason: 'planless_companion',
      }),
    },
  });
}

/** Mark state of one task. */
export interface RecheckMark {
  /** The newest pending/passed row is pending. / 印が有効か */
  pending: boolean;
  /** createdAt of that pending row (ms), the queue order. / 印の時刻 */
  markAt: number | null;
}

/**
 * Read whether the task carries an unconsumed pending mark.
 *
 * An absent model (partial test mocks) is "no mark"; a rejected read throws.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task / タスクID
 * @returns Mark state / 印の状態
 * @throws {Error} When the read rejects / 読み取り失敗時
 */
export async function readRecheckMark(prisma: unknown, taskId: number): Promise<RecheckMark> {
  const m = model(prisma);
  if (typeof m.findMany !== 'function') return { pending: false, markAt: null };
  const rows = await m.findMany({
    where: { taskId, cause: { in: [RECHECK_PENDING_CAUSE, RECHECK_PASSED_CAUSE] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { cause: true, createdAt: true },
  });
  const latest = rows?.[0];
  if (!latest || latest.cause !== RECHECK_PENDING_CAUSE) return { pending: false, markAt: null };
  return { pending: true, markAt: latest.createdAt.getTime() };
}

/**
 * Signature of the newest held row written after `sinceMs`, or null.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task / タスクID
 * @param sinceMs - Only rows at or after this time count (the mark) / 起点
 * @returns Stored signature / 保存済みの署名
 */
export async function readLastHeldSignature(
  prisma: unknown,
  taskId: number,
  sinceMs: number | null,
): Promise<string | null> {
  const m = model(prisma);
  if (typeof m.findFirst !== 'function') return null;
  const row = await m.findFirst({
    where: {
      taskId,
      cause: RECHECK_HELD_CAUSE,
      ...(sinceMs != null ? { createdAt: { gte: new Date(sinceMs) } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { cause: true, createdAt: true, metadata: true },
  });
  if (!row?.metadata) return null;
  try {
    const parsed = JSON.parse(row.metadata) as { signature?: unknown };
    return typeof parsed.signature === 'string' ? parsed.signature : null;
  } catch {
    return null;
  }
}

/**
 * Stable signature of a hold reason, so the same reason is logged once.
 *
 * @param opponentTaskId - Task waited on, or null / 相手タスク
 * @param reason - Reason id / 理由
 * @param files - Overlapping files / 重なったファイル
 * @returns Signature / 署名
 */
export function heldSignature(
  opponentTaskId: number | null,
  reason: string,
  files: string[],
): string {
  return `${opponentTaskId ?? '-'}|${reason}|${[...new Set(files)].sort().join(',')}`;
}

/** One held task. */
export interface RecheckHold {
  /** When the current hold began (ms). / 保留開始 */
  since: number;
  /** Waiting on another task (exempt from the tenure wall). / 時間上限の免除 */
  exempt: boolean;
  /** Last reason signature logged. / 最後に記録した署名 */
  signature: string;
}

const holds = new Map<number, RecheckHold>();

/**
 * Record (or refresh) a hold; keeps the original start.
 *
 * @param taskId - Task / タスクID
 * @param exempt - Whether the tenure wall is waived / 免除するか
 * @param signature - Reason signature / 署名
 * @param now - Current time (ms) / 現在時刻
 * @returns The previous entry, if any / 直前の保留
 */
export function setRecheckHold(
  taskId: number,
  exempt: boolean,
  signature: string,
  now: number,
): RecheckHold | undefined {
  const prev = holds.get(taskId);
  holds.set(taskId, { since: prev?.since ?? now, exempt, signature });
  return prev;
}

/** Drop the task's hold. */
export function clearRecheckHold(taskId: number): void {
  holds.delete(taskId);
}

/**
 * The task's hold entry, if held.
 *
 * @param taskId - Task / タスクID
 * @returns Entry or undefined / 保留情報
 */
export function getRecheckHold(taskId: number): RecheckHold | undefined {
  return holds.get(taskId);
}

/**
 * Whether the task waits on another task at the re-check, which exempts it
 * from the hang backstop. Holds with no opponent (missing files, unreadable
 * state) are NOT exempt, so the backstop still surfaces them.
 *
 * @param taskId - Task / タスクID
 * @returns True when exempt-held / 免除つきで保留中なら true
 */
export function isParallelRecheckHeld(taskId: number): boolean {
  return holds.get(taskId)?.exempt === true;
}

/** Clears the hold table between tests. */
export function resetRecheckHoldState(): void {
  holds.clear();
}

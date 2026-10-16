/**
 * resume-condition/store
 *
 * Reads and appends `resume_condition_*` WorkflowTransition rows (no schema
 * change) and sweeps invalidated conditions. Pure rules live in validity.ts;
 * this module only does I/O. NOT responsible for answer parsing.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import type { BlockedExclusionReason } from '../blocked-task-policy';
import { resolveResumeReleases } from './override';
import {
  RESUME_CONDITION_APPROVED_CAUSE,
  RESUME_CONDITION_REVOKED_CAUSE,
  RESUME_CONDITION_TTL_MS,
  type ResumableReason,
  type ResumeCondition,
  type ResumeConditionSpec,
  type ResumeEventRow,
} from './types';
import { evaluateResumeCondition, type ConditionState } from './validity';

type Db = InstanceType<typeof PrismaClient>;

const log = createLogger('resume-condition');

const ESCALATED_CAUSE = 'blocked_escalated';
const RESUME_CAUSES = [RESUME_CONDITION_APPROVED_CAUSE, RESUME_CONDITION_REVOKED_CAUSE];

/** Task facts the store needs. */
export interface ResumeTaskRef {
  id: number;
  status: string;
  workflowStatus: string | null;
}

/**
 * Identify the current stop: the latest `blocked_escalated` row, else the latest
 * stop-independent transition. Re-escalations and our own rows are excluded so
 * they do not look like a state change.
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param taskId - Task id. / タスクID
 * @returns Marker row id (0 when the task has no history). / 停止マーカーID
 */
export async function loadStopMarkerId(db: Db, taskId: number): Promise<number> {
  const esc = await db.workflowTransition.findFirst({
    where: { taskId, cause: ESCALATED_CAUSE },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  if (esc) return esc.id;
  const any = await db.workflowTransition.findFirst({
    where: { taskId, cause: { notIn: [...RESUME_CAUSES, 'blocked_reescalated'] } },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  return any?.id ?? 0;
}

/**
 * Load every resume-condition row of one task.
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param taskId - Task id. / タスクID
 * @returns Approved/revoked rows. / 条件行
 */
export async function loadResumeRows(db: Db, taskId: number): Promise<ResumeEventRow[]> {
  return db.workflowTransition.findMany({
    where: { taskId, cause: { in: RESUME_CAUSES } },
    select: { id: true, cause: true, createdAt: true, metadata: true },
    orderBy: { id: 'asc' },
  });
}

/**
 * Evaluate the current condition state of a task.
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param task - Live task facts. / タスク状態
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Condition state. / 条件状態
 */
export async function loadConditionState(
  db: Db,
  task: ResumeTaskRef,
  nowMs: number,
): Promise<ConditionState> {
  const [rows, stopMarkerId] = await Promise.all([
    loadResumeRows(db, task.id),
    loadStopMarkerId(db, task.id),
  ]);
  return evaluateResumeCondition(
    rows,
    { status: task.status, workflowStatus: task.workflowStatus, stopMarkerId },
    nowMs,
    task.id,
  );
}

/**
 * Reasons currently released for a blocked task. Fail-safe: an unreadable
 * history releases nothing, so the task simply stays excluded as before.
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param task - Blocked task facts. / タスク
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Released reasons. / 解除理由
 */
export async function loadResumeReleases(
  db: Db,
  task: ResumeTaskRef,
  nowMs: number,
): Promise<BlockedExclusionReason[]> {
  try {
    return resolveResumeReleases(await loadConditionState(db, task, nowMs));
  } catch (err) {
    log.warn({ err, taskId: task.id }, '[resume-condition] evaluation failed — releasing nothing');
    return [];
  }
}

/**
 * The stop reason recorded by the latest escalation, if any.
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param taskId - Task id. / タスクID
 * @returns Reason string or null. / 停止理由
 */
export async function loadStopReason(db: Db, taskId: number): Promise<string | null> {
  const esc = await db.workflowTransition.findFirst({
    where: { taskId, cause: ESCALATED_CAUSE },
    orderBy: { id: 'desc' },
    select: { metadata: true },
  });
  if (!esc?.metadata) return null;
  try {
    const m = JSON.parse(esc.metadata) as { reason?: unknown };
    return typeof m.reason === 'string' ? m.reason : null;
  } catch {
    return null;
  }
}

/**
 * Build the globally unique question id for one stop.
 *
 * @param taskId - Task id. / タスクID
 * @param reason - Stop reason. / 停止理由
 * @param stopMarkerId - Marker from loadStopMarkerId. / 停止マーカー
 * @returns Question id. / 質問ID
 */
export function buildQuestionId(taskId: number, reason: string, stopMarkerId: number): string {
  return `rq-${taskId}-${reason}-${stopMarkerId}`;
}

/** Input for {@link approveCondition}. */
export interface ApproveInput {
  task: ResumeTaskRef;
  questionId: string;
  reason: ResumableReason;
  spec: ResumeConditionSpec;
  stopMarkerId: number;
  nowMs: number;
  source: string;
}

/**
 * Persist an approved condition valid for 24h. Throws on DB failure so the
 * caller can answer 500 (a condition must never be silently "approved").
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param input - Approval facts. / 承認情報
 * @returns The stored condition. / 保存した条件
 */
export async function approveCondition(db: Db, input: ApproveInput): Promise<ResumeCondition> {
  const { task, nowMs } = input;
  const condition: ResumeCondition = {
    questionId: input.questionId,
    taskId: task.id,
    reason: input.reason,
    spec: input.spec,
    approvedAt: nowMs,
    expiresAt: nowMs + RESUME_CONDITION_TTL_MS,
    snapshot: {
      status: task.status,
      workflowStatus: task.workflowStatus,
      stopMarkerId: input.stopMarkerId,
    },
  };
  await db.workflowTransition.create({
    data: {
      taskId: task.id,
      fromStatus: task.workflowStatus ?? 'blocked',
      toStatus: task.workflowStatus ?? 'blocked',
      actor: 'user',
      cause: RESUME_CONDITION_APPROVED_CAUSE,
      metadata: JSON.stringify({
        questionId: condition.questionId,
        reason: condition.reason,
        spec: condition.spec,
        approvedAt: condition.approvedAt,
        expiresAt: condition.expiresAt,
        snapshot: condition.snapshot,
        source: input.source,
      }),
    },
  });
  return condition;
}

/**
 * Record that a condition is no longer valid.
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param task - Task facts. / タスク
 * @param questionId - Condition's question id. / 質問ID
 * @param revokedBy - Why it was invalidated. / 失効理由
 */
export async function revokeCondition(
  db: Db,
  task: ResumeTaskRef,
  questionId: string,
  revokedBy: 'expired' | 'state_changed',
): Promise<void> {
  await db.workflowTransition.create({
    data: {
      taskId: task.id,
      fromStatus: task.workflowStatus ?? task.status,
      toStatus: task.workflowStatus ?? task.status,
      actor: 'system',
      cause: RESUME_CONDITION_REVOKED_CAUSE,
      metadata: JSON.stringify({ questionId, revokedBy }),
    },
  });
}

/**
 * Materialize expiry / state-change as `resume_condition_revoked` rows, once
 * per condition (a revoked condition evaluates as `revoked`, so a second pass
 * writes nothing). Never throws.
 *
 * @param db - Prisma client. / Prismaクライアント
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of revocations written. / 失効記録数
 */
export async function sweepResumeConditions(db: Db, nowMs: number): Promise<number> {
  let revoked = 0;
  try {
    // Approvals older than 2 TTLs are already invalid and were swept long ago.
    const recent = await db.workflowTransition.findMany({
      where: {
        cause: RESUME_CONDITION_APPROVED_CAUSE,
        createdAt: { gt: new Date(nowMs - 2 * RESUME_CONDITION_TTL_MS) },
      },
      select: { taskId: true },
      distinct: ['taskId'],
    });
    for (const { taskId } of recent) {
      if (taskId == null) continue;
      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, status: true, workflowStatus: true },
      });
      if (!task) continue;
      const st = await loadConditionState(db, task, nowMs);
      if (st.state !== 'expired' && st.state !== 'state_changed') continue;
      await revokeCondition(db, task, st.condition.questionId, st.state);
      revoked++;
    }
  } catch (err) {
    log.warn({ err }, '[resume-condition] sweep failed');
  }
  return revoked;
}

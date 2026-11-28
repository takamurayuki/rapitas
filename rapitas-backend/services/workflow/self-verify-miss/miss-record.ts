/**
 * self-verify-miss/miss-record
 *
 * Records a self-verify miss (task 1602): when a real gate fails a task whose
 * latest self-verify run passed, one `self_verify_miss` TimelineEvent names
 * that run, its SHA, the gate, the reason and the files. Never throws — a
 * recording failure must not change what the gate does. Not responsible for
 * deciding pass/fail or for the gate's own side effects.
 */
import { createLogger } from '../../../config/logger';
import { appendEvent, queryEvents } from '../../memory/timeline';
import { correlationIdFor } from '../verification-job-store';
import {
  SELF_VERIFY_MISS_EVENT,
  classifyRepairMiss,
  filesForMiss,
  gateFamilyOf,
  kindOfGate,
  missCorrelationId,
  summarizeReason,
  type SelfVerifyMissGate,
  type SelfVerifyMissPayload,
} from './miss-classify';

const log = createLogger('workflow:self-verify-miss');

/** The passing self-verify run a gate failure is compared against. */
export interface PassingJob {
  runId: string;
  revision: string | null;
  changedFiles: string[];
}

/**
 * The task's newest completed self-verify job, when it passed. A job that
 * crashed (status `failed`) is skipped; an unverifiable pass is no pass.
 *
 * @param taskId - Task / タスクID
 * @returns The passing job, or null / 合格ジョブ
 */
export async function findPassingJob(taskId: number): Promise<PassingJob | null> {
  const correlationId = correlationIdFor(taskId);
  const { events } = await queryEvents({
    correlationId,
    eventType: 'verification_job_finished',
    limit: 50,
  });
  const latest = events.find((e) => (e.payload as { status?: string }).status === 'completed');
  if (!latest) return null;
  const p = latest.payload as {
    runId: string;
    ok?: boolean;
    unverifiable?: boolean;
    changedFiles?: string[];
  };
  if (p.ok !== true || p.unverifiable) return null;
  const starts = await queryEvents({
    correlationId,
    eventType: 'verification_job_started',
    limit: 200,
  });
  const start = starts.events.find((e) => (e.payload as { runId?: string }).runId === p.runId);
  const revision = (start?.payload as { revision?: string | null } | undefined)?.revision ?? null;
  return { runId: p.runId, revision, changedFiles: p.changedFiles ?? [] };
}

/** One real-gate failure to file. */
export interface MissInput {
  taskId: number;
  gate: SelfVerifyMissGate;
  checkName?: string | null;
  reason: string;
  findings?: unknown[];
  /** Files the gate reported itself. */
  files?: string[];
}

/**
 * File one miss when a passing self-verify run preceded the failure.
 *
 * @param input - Task, gate and reason / 記録内容
 * @returns True when a new miss was stored / 記録したか
 */
export async function recordSelfVerifyMiss(input: MissInput): Promise<boolean> {
  try {
    const job = await findPassingJob(input.taskId);
    if (!job) return false;
    const dedupKey = `${job.runId}|${input.gate}`;
    const correlationId = missCorrelationId(input.taskId);
    const prior = await queryEvents({
      correlationId,
      eventType: SELF_VERIFY_MISS_EVENT,
      limit: 500,
    });
    if (prior.events.some((e) => (e.payload as { dedupKey?: string }).dedupKey === dedupKey)) {
      return false;
    }
    const payload: SelfVerifyMissPayload = {
      taskId: input.taskId,
      runId: job.runId,
      revision: job.revision,
      gate: input.gate,
      gateFamily: gateFamilyOf(input.gate),
      checkName: input.checkName ?? null,
      kind: kindOfGate(input.gate),
      reasonSummary: summarizeReason(input.reason),
      files: filesForMiss(input.reason, input.findings ?? [], job.changedFiles, input.files),
      dedupKey,
    };
    await appendEvent({
      eventType: SELF_VERIFY_MISS_EVENT,
      actorType: 'system',
      correlationId,
      payload: { ...payload },
    });
    return true;
  } catch (err) {
    log.warn(
      { err, taskId: input.taskId, gate: input.gate },
      'Failed to record a self-verify miss',
    );
    return false;
  }
}

/**
 * File the misses behind one verify→implement rejection (see classifyRepairMiss).
 *
 * @param taskId - Task / タスクID
 * @param reason - Rejection reason / 差し戻し理由
 * @param grounds - Findings and the caller's miss hint / 指摘と指定
 * @returns How many misses were stored / 記録件数
 */
export async function recordRepairMisses(
  taskId: number,
  reason: string,
  grounds?: { findings?: unknown[]; missGate?: 'none' },
): Promise<number> {
  let stored = 0;
  for (const m of classifyRepairMiss(reason, grounds)) {
    const ok = await recordSelfVerifyMiss({
      taskId,
      gate: m.gate,
      checkName: m.checkName,
      reason,
      findings: grounds?.findings,
    });
    if (ok) stored++;
  }
  return stored;
}

/**
 * Verification stop record
 *
 * Appends the transition that says which check withheld a commit/PR and why,
 * and answers whether such a stop is the task's latest transition. Not
 * responsible for deciding the stop or changing task state. Neither side throws.
 */
// NOTE: Writes through the `config` barrel rather than recordTransition: the
// auto-commit tests replace that barrel, so the write can never reach a real DB.
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import type { GateOutcome } from '../../agents/verification/verification-gate';
import type { PreSaveCheckResult } from '../../../routes/workflow/workflow-auto-commit-presave';
import type { PublishGuardResult } from '../../../routes/workflow/workflow-auto-commit-publish-guard';
import { VERIFICATION_UNVERIFIABLE_HOLD_CAUSE } from '../blocked-task-policy';

const log = createLogger('workflow:verification-stop');

/** Transition cause of a verification stop. Deliberately not auto-resumable. */
export const VERIFICATION_STOPPED_CAUSE = 'verification_stopped';

/** The row is read by the UI and a check log tail is unbounded. */
const TEXT_LIMIT = 2000;
const FRESH_WINDOW_MS = 30 * 60_000;

export interface VerificationStop {
  taskId: number;
  stage: 'pre_save' | 'post_commit_gate' | 'publish_guard';
  summary: string;
  reason: string;
  failedChecks: string[];
  details: Array<{ name: string; details: string }>;
}

const clip = (text: string | undefined) => (text ?? '').slice(0, TEXT_LIMIT);

/**
 * Append one stop row, retrying once. The status columns repeat the current
 * workflowStatus so blocked-retry's resume stage is not affected.
 *
 * @param stop - Which stage stopped, on which checks and why / 停止の内容
 */
export async function recordVerificationStop(stop: VerificationStop): Promise<void> {
  const { taskId, stage, failedChecks } = stop;
  const write = async () => {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workflowStatus: true },
    });
    // Every caller runs after verify.md was saved, hence the fallback.
    const status = task?.workflowStatus ?? 'verify_done';
    await prisma.workflowTransition.create({
      data: {
        taskId,
        fromStatus: status,
        toStatus: status,
        actor: 'system',
        cause: VERIFICATION_STOPPED_CAUSE,
        phase: 'verify',
        metadata: JSON.stringify({
          stage,
          summary: clip(stop.summary),
          reason: clip(stop.reason),
          failedChecks,
          details: stop.details.map((d) => ({ name: d.name, details: clip(d.details) })),
        }),
      },
    });
  };
  try {
    await write().catch(write);
  } catch (err) {
    log.warn({ err, taskId, stage, failedChecks }, 'Failed to record the verification stop');
  }
}

/**
 * Record a stop by the pre-save checks. Plan scope is advisory and not listed.
 *
 * @param taskId - Task / タスクID
 * @param preSave - Pre-save verdict / ローカル保存前チェックの結果
 * @param reason - Error returned to the caller / 呼び出し元へ返す理由
 */
export async function recordPreSaveStop(
  taskId: number,
  preSave: PreSaveCheckResult,
  reason: string,
): Promise<void> {
  const failed = [
    ...(preSave.tamper && !preSave.tamper.ok
      ? [{ name: 'tamper', details: preSave.tamper.details ?? '' }]
      : []),
    ...(preSave.secrets.length ? [{ name: 'secret', details: preSave.secrets.join('\n') }] : []),
    ...(preSave.unattributed.length
      ? [{ name: 'attribution', details: preSave.unattributed.join('\n') }]
      : []),
  ];
  await recordVerificationStop({
    taskId,
    stage: 'pre_save',
    summary: preSave.summary,
    reason,
    failedChecks: failed.map((f) => f.name),
    details: failed,
  });
}

/**
 * Record a stop by the verification gate. Skipped when the gate itself recorded
 * `verification_unverifiable_hold` (same condition as verification-gate.ts).
 *
 * @param taskId - Task / タスクID
 * @param gate - Failing gate outcome / 失敗したゲート結果
 * @param reason - Error returned to the caller / 呼び出し元へ返す理由
 */
export async function recordGateStop(
  taskId: number,
  gate: GateOutcome,
  reason: string,
): Promise<void> {
  const checks = gate.result?.checks ?? [];
  if (gate.result?.unverifiable && checks.some((c) => c.unverifiable)) return;
  const failed = checks.filter((c) => !c.ok);
  await recordVerificationStop({
    taskId,
    stage: 'post_commit_gate',
    summary: gate.result?.summary ?? '',
    reason,
    // No failing check means the verifier itself could not finish.
    failedChecks: failed.length ? failed.map((c) => c.name) : ['verifier'],
    details: failed.map((c) => ({ name: c.name, details: c.details ?? '' })),
  });
}

/**
 * Record a re-verification failure after the base sync. Other withheld publishes
 * (dirty tree, merge conflict) are not verification stops and are ignored.
 *
 * @param taskId - Task / タスクID
 * @param guard - Publish-guard result / 公開前ガードの結果
 * @param startedAt - When the guard started, to find a hold its re-run recorded / ガード開始時刻
 */
export async function recordPublishGuardStop(
  taskId: number,
  guard: PublishGuardResult,
  startedAt: Date,
): Promise<void> {
  if (!guard.verificationBlocked) return;
  if (guard.verificationUnverifiable) {
    // The guard does not expose the re-run's checks, so ask for the row itself.
    const held = await Promise.resolve()
      .then(() =>
        prisma.workflowTransition.findFirst({
          where: {
            taskId,
            cause: VERIFICATION_UNVERIFIABLE_HOLD_CAUSE,
            createdAt: { gte: startedAt },
          },
          select: { id: true },
        }),
      )
      .catch(() => null);
    if (held) return;
  }
  await recordVerificationStop({
    taskId,
    stage: 'publish_guard',
    summary: guard.error ?? '',
    reason: guard.error ?? '',
    failedChecks: ['reverify'],
    details: [{ name: 'reverify', details: guard.baseSync.detail }],
  });
}

/**
 * Whether the task's latest transition is a recent verification stop. Such a row
 * can cover an earlier rejection, so a landed PR must not complete the task.
 *
 * @param taskId - Task / タスクID
 * @returns True when fresh; false when not or unreadable / 直近の停止なら true
 */
export async function hasFreshVerificationStop(taskId: number): Promise<boolean> {
  try {
    const last = await prisma.workflowTransition.findFirst({
      where: { taskId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { cause: true, createdAt: true },
    });
    return (
      last?.cause === VERIFICATION_STOPPED_CAUSE &&
      Date.now() - last.createdAt.getTime() <= FRESH_WINDOW_MS
    );
  } catch {
    return false;
  }
}

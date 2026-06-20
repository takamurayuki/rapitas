/**
 * Intake Gate
 *
 * Runs once, just before the research phase, to raise a thin task spec to a
 * workable quality bar. It auto-enriches the spec (goals / constraints /
 * acceptance criteria) from the description, and — per policy — either pauses
 * for a single clarifying question or proceeds on best-guess with a recorded
 * low-confidence flag.
 *
 * Idempotent: re-running on an already-adequate (or already-asked) task is a
 * no-op, so it is safe to call on every `draft → research` advance, including
 * after a question is answered (status returns to draft and the gate re-runs).
 * Not responsible for launching the researcher — the orchestrator does that.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import {
  resolveWorkflowDir,
  readWorkflowFile,
  writeWorkflowFile,
} from '../workflow/workflow-file-utils';
import { recordTransition } from '../workflow/transition-recorder';
import { deriveTaskSpec } from '../task/task-spec-deriver';
import { createNotification } from '../communication/notification-service';
import {
  checkSpecQuality,
  mergeSpecField,
  parseSpecArray,
  type SpecQualityInput,
  type SpecQualityResult,
} from './spec-quality-checker';
import { resolveIntakePolicy, decideIntake } from './intake-policy';
import { buildIntakeQuestion } from './intake-question-template';

const log = createLogger('intake-gate');

/** Result of {@link ensureIntakeReady}. */
export interface IntakeOutcome {
  /**
   * - `ready`: spec is adequate, proceed to research.
   * - `awaiting_question`: a clarifying question was raised; workflow paused.
   * - `proceed_low_confidence`: spec is thin but policy says proceed anyway.
   */
  status: 'ready' | 'awaiting_question' | 'proceed_low_confidence';
  /** Optional human-readable note for the caller's result/output. */
  message?: string;
}

/** The task fields the gate reads — typed loosely so a pre-migration Prisma
 * client (no goals/constraints/acceptanceCriteria columns) degrades gracefully
 * to "fields absent → treated as missing" instead of crashing. */
interface IntakeTaskRow extends SpecQualityInput {
  id: number;
  title: string;
  workflowStatus: string | null;
}

/**
 * Ensure a task's spec is good enough to run research autonomously.
 *
 * @param taskId - The task entering its research phase. / 調査フェーズに入るタスクID
 * @returns The intake outcome the orchestrator must act on. / オーケストレータが扱う結果
 */
export async function ensureIntakeReady(taskId: number): Promise<IntakeOutcome> {
  const row = await prisma.task.findUnique({ where: { id: taskId } });
  if (!row) return { status: 'ready' };

  // Read spec fields via a narrow cast (see IntakeTaskRow) so an unknown-column
  // client cannot throw on access — missing columns read as undefined.
  const task = row as unknown as IntakeTaskRow;

  let quality = checkSpecQuality(task);
  if (quality.isAdequate) return { status: 'ready' };

  // 1) Auto-enrich from description (+ any prior answer in question.md). Failures
  //    are swallowed — the gate still asks/proceeds below.
  const enriched = await enrichSpec(taskId, task).catch((err) => {
    log.warn({ err, taskId }, '[intake-gate] enrichment failed (non-fatal)');
    return null;
  });
  if (enriched) {
    quality = checkSpecQuality(enriched);
    if (quality.isAdequate) {
      log.info({ taskId, score: quality.score }, '[intake-gate] spec enriched to adequate');
      return { status: 'ready' };
    }
  }

  // 2) Still thin → decide: ask once, or proceed on best-guess.
  const alreadyAsked = await hasPriorIntakeQuestion(taskId);
  const { policy, source } = resolveIntakePolicy();
  const action = decideIntake(false, alreadyAsked, policy);

  if (action === 'ask') {
    await raiseIntakeQuestion(task, quality);
    return {
      status: 'awaiting_question',
      message: '仕様が不十分なため確認の質問を作成しました（回答後に再開します）',
    };
  }

  await recordLowConfidence(task, quality, policy, alreadyAsked);
  log.info(
    { taskId, score: quality.score, missing: quality.missing, policy, source, alreadyAsked },
    '[intake-gate] proceeding with thin spec (best-guess)',
  );
  return {
    status: 'proceed_low_confidence',
    message: '仕様が不十分ですが、ポリシーにより best-guess で実行を継続します',
  };
}

/**
 * Derive a spec from the description (+ prior answer) and persist any net-new
 * items. Returns the post-merge spec view, or null when nothing was added.
 */
async function enrichSpec(taskId: number, task: IntakeTaskRow): Promise<SpecQualityInput | null> {
  const resolved = await resolveWorkflowDir(taskId);
  const priorAnswer = resolved ? await readWorkflowFile(resolved.dir, 'question') : null;
  const basis = [task.description ?? '', priorAnswer ?? ''].join('\n\n').trim();
  if (!basis) return null;

  const { spec, source } = await deriveTaskSpec(basis);
  if (source !== 'ai') return null;

  const goals = mergeSpecField(task.goals, spec.goals);
  const constraints = mergeSpecField(task.constraints, spec.constraints);
  const acceptanceCriteria = mergeSpecField(task.acceptanceCriteria, spec.acceptanceCriteria);

  const grew =
    goals.length > parseSpecArray(task.goals).length ||
    constraints.length > parseSpecArray(task.constraints).length ||
    acceptanceCriteria.length > parseSpecArray(task.acceptanceCriteria).length;
  if (!grew) return null;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      goals: JSON.stringify(goals),
      constraints: JSON.stringify(constraints),
      acceptanceCriteria: JSON.stringify(acceptanceCriteria),
      updatedAt: new Date(),
    },
  });
  await recordTransition({
    taskId,
    fromStatus: task.workflowStatus ?? null,
    toStatus: task.workflowStatus ?? 'draft',
    actor: 'system',
    cause: 'intake_enriched',
    phase: 'research',
    metadata: {
      goals: goals.length,
      constraints: constraints.length,
      acceptanceCriteria: acceptanceCriteria.length,
    },
  });

  return { description: task.description, goals, constraints, acceptanceCriteria };
}

/** Whether an intake clarifying question was already raised for this task. */
async function hasPriorIntakeQuestion(taskId: number): Promise<boolean> {
  const prior = await prisma.workflowTransition
    .findFirst({ where: { taskId, cause: 'intake_question' }, select: { id: true } })
    .catch(() => null);
  return prior !== null;
}

/** Write the clarifying question.md and move the task to awaiting_question. */
async function raiseIntakeQuestion(task: IntakeTaskRow, quality: SpecQualityResult): Promise<void> {
  const resolved = await resolveWorkflowDir(task.id);
  if (!resolved) {
    log.warn({ taskId: task.id }, '[intake-gate] cannot resolve workflow dir — skipping question');
    return;
  }
  const body = buildIntakeQuestion({
    title: task.title,
    missing: quality.missing,
    reasons: quality.reasons,
  });
  await writeWorkflowFile(resolved.dir, 'question', body, task.id);

  const fromStatus = task.workflowStatus ?? 'draft';
  await prisma.task.update({
    where: { id: task.id },
    data: { workflowStatus: 'awaiting_question', updatedAt: new Date() },
  });
  // previousStatus lets resume-from-question restore the pre-question status
  // (draft), which re-triggers this gate — now hasPriorIntakeQuestion()=true.
  await recordTransition({
    taskId: task.id,
    fromStatus,
    toStatus: 'awaiting_question',
    actor: 'system',
    cause: 'intake_question',
    phase: 'question',
    metadata: { previousStatus: fromStatus, missing: quality.missing, score: quality.score },
  });
}

/** Record (audit + notify) that we proceeded despite a thin spec. */
async function recordLowConfidence(
  task: IntakeTaskRow,
  quality: SpecQualityResult,
  policy: string,
  alreadyAsked: boolean,
): Promise<void> {
  const status = task.workflowStatus ?? 'draft';
  await recordTransition({
    taskId: task.id,
    fromStatus: status,
    toStatus: status,
    actor: 'system',
    cause: 'intake_low_confidence',
    phase: 'research',
    metadata: { missing: quality.missing, score: quality.score, policy, alreadyAsked },
  });
  // Surface it so "proceed on best-guess" is never silent (the anti-pattern).
  await createNotification({
    type: 'system',
    title: '仕様が不十分なまま実行',
    message: `タスク #${task.id}「${task.title}」は仕様が不十分ですが、ポリシーにより実行を継続します（要確認）。`,
    link: `/tasks?taskId=${task.id}`,
    metadata: { taskId: task.id, missing: quality.missing, score: quality.score },
  }).catch(() => {});
}

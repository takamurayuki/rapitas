/**
 * Intake: required spec
 *
 * Pauses a development task at awaiting_question while its required items
 * (goals, a completion criterion) are missing (#1555). A subtask takes them
 * from its parent when it has none of its own (#1559). Runs after the intake
 * gate's own checks and enrichment, so what the description already implies
 * is filled in first and only what is truly missing stops the task. Unlike a
 * thin spec, a missing required item is never proceeded past on best-guess:
 * answering the question without filling the items in asks again.
 *
 * awaiting_question is a state auto-run already never selects, so a stopped
 * task cannot make a theme flap between running and idle. Not responsible
 * for deciding what is required (`task/task-spec-requirements.ts`).
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { writeWorkflowFile } from '../workflow/workflow-file-utils';
import { recordTransition } from '../workflow/transition-recorder';
import { notifyIntakeQuestionPending } from '../communication/notification-service';
import {
  missingRequiredSpec,
  requiredSpecQuestion,
  type RequiredSpecInput,
} from '../task/task-spec-requirements';
import { parseSpecArray } from './spec-quality-checker';

const log = createLogger('intake-required-spec');

/** A subtask's spec with each empty part taken from its parent. */
function withParent(own: RequiredSpecInput, parent: RequiredSpecInput): RequiredSpecInput {
  const pick = (mine: unknown, theirs: unknown) =>
    parseSpecArray(mine).length > 0 ? mine : theirs;
  const ownHasCompletion =
    parseSpecArray(own.acceptanceCriteria).length > 0 ||
    parseSpecArray(own.userAcceptanceChecks).length > 0;
  return {
    goals: pick(own.goals, parent.goals),
    acceptanceCriteria: ownHasCompletion ? own.acceptanceCriteria : parent.acceptanceCriteria,
    userAcceptanceChecks: ownHasCompletion ? own.userAcceptanceChecks : parent.userAcceptanceChecks,
  };
}

/** Transition cause of a pause for missing required items. */
export const REQUIRED_SPEC_CAUSE = 'intake_required_spec';

/**
 * Pause the task when it belongs to a development theme and lacks a required item.
 *
 * @param taskId - Task about to enter research / 調査に入るタスクID
 * @returns True when the task was paused / 止めた場合 true
 */
export async function holdForRequiredSpec(taskId: number): Promise<boolean> {
  // Read fresh: the gate may just have written enriched goals and criteria.
  const row = (await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      workflowStatus: true,
      goals: true,
      acceptanceCriteria: true,
      userAcceptanceChecks: true,
      theme: { select: { isDevelopment: true } },
      parent: {
        select: {
          goals: true,
          acceptanceCriteria: true,
          userAcceptanceChecks: true,
          theme: { select: { isDevelopment: true } },
        },
      },
    },
  })) as {
    id: number;
    title: string;
    workflowStatus: string | null;
    goals: unknown;
    acceptanceCriteria: unknown;
    userAcceptanceChecks: unknown;
    theme: { isDevelopment: boolean } | null;
    parent?: {
      goals: unknown;
      acceptanceCriteria: unknown;
      userAcceptanceChecks: unknown;
      theme: { isDevelopment: boolean } | null;
    } | null;
  } | null;
  if (!row) return false;
  // A subtask is a step of its parent (#1559): the parent defines the goals
  // and the completion conditions, and its own count only when it has some.
  const parent = row.parent ?? null;
  if (!(row.theme?.isDevelopment ?? parent?.theme?.isDevelopment)) return false;
  const missing = missingRequiredSpec(parent ? withParent(row, parent) : row);
  if (missing.length === 0) return false;

  await writeWorkflowFile(taskId, 'question', requiredSpecQuestion(row.title, missing));
  const fromStatus = row.workflowStatus ?? 'draft';
  await prisma.task.update({
    where: { id: taskId },
    data: { workflowStatus: 'awaiting_question', updatedAt: new Date() },
  });
  // previousStatus makes resume-from-question return to draft, which runs the
  // gate again: the task moves on only once the items are actually filled in.
  await recordTransition({
    taskId,
    fromStatus,
    toStatus: 'awaiting_question',
    actor: 'system',
    cause: REQUIRED_SPEC_CAUSE,
    phase: 'question',
    metadata: { previousStatus: fromStatus, kind: 'spec_change', missing },
  });
  await notifyIntakeQuestionPending({ taskId, taskTitle: row.title }).catch(() => {});
  log.info({ taskId, missing }, '[intake-required-spec] paused for missing required items');
  return true;
}

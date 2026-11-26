/**
 * Workflow Handlers / Resume Dispatch
 *
 * Single kind-based entry point for resolving an `awaiting_question` pause:
 * reads the pause's recorded (or derived) kind and routes to the reset-draft
 * path (spec_change) or the plan-preserving resume path (execution_continuation
 * / completion_confirmation), so the caller (HTTP `answer-question` handler,
 * the stale-question auto-answer heal pass) never has to pick between the two
 * underlying appliers itself. Split out of workflow-handlers-resume.ts (task
 * 902) to stay under the file-size ratchet. Not responsible for validating
 * the HTTP request — callers do that before invoking this.
 */
import { prisma, createLogger } from '../../../config';
import { ConflictError, NotFoundError, ValidationError } from '../../../middleware/error-handler';
import type { TransitionActor } from '../../../services/workflow/transition-recorder';
import { withTaskLifecycleLock } from '../../../services/workflow/task-lifecycle-lock';
import { isLatestExecutionCancelled } from '../../../services/workflow/publication-cancellation-guard';
import {
  resolveExplicitOrDefaultKind,
  resolveQuestionAnswerStrategy,
  readQuestionMetadata,
  type QuestionKind,
} from '../../../services/workflow/question-kind-resolver';
import type { WorkflowStatus } from '../../../services/workflow/workflow-types';
import { applyIntakeQuestionAnswerLocked, type AnswerSelection } from './workflow-handlers-resume';
import { applyResumeFromQuestionAnswerLocked } from './workflow-handlers-resume-continuation';
import { readWorkflowFile } from '../../../services/workflow/workflow-file-utils';
import {
  decideAnswerRouting,
  matchQuestionSelections,
  requestsFileApproval,
  type AnswerRoutingReason,
  type SelectedOption,
} from '../../../services/workflow/question-answer-routing';
import { preparePlanScopeGrant } from '../../../services/workflow/plan-scope-grant';
import {
  persistPlanRevisionCore,
  mapAnswerSourceLabelToRevisionSource,
} from '../../../services/workflow/plan-revision-persistence';

const log = createLogger('routes:workflow:resume-dispatch');

/**
 * The `kind` a routed answer resolves to. Extends {@link QuestionKind} (why
 * the question was raised) with `plan_revision` — an OUTCOME of routing, not
 * a raise-time reason, so it deliberately does not join `QuestionKind` itself
 * (task 933).
 */
export type QuestionAnswerKind = QuestionKind | 'plan_revision';

/** Input to {@link applyQuestionAnswerByKind}. */
export interface ApplyQuestionAnswerByKindParams {
  taskId: number;
  /**
   * Answer text. Required for `spec_change` (rejected with a
   * `ValidationError` when absent — a resume-from-question caller with no
   * answer body must never silently treat an unconfirmed spec change as
   * answered). Optional for `execution_continuation`/`completion_confirmation`,
   * matching `resume-from-question`'s historical no-body shape. / 回答本文
   */
  answer?: string;
  /** Who is recorded as having answered. / 記録するactor */
  actor: TransitionActor;
  /** Label folded into question.md's answer heading (intake path only). / 回答元ラベル */
  sourceLabel?: string;
  selections?: AnswerSelection[];
  /** Extra fields merged into the recorded transition's metadata. / 追加メタデータ */
  extraMetadata?: Record<string, unknown>;
  /**
   * Let this answer supersede a stop that sealed the pause (task 944). Set
   * ONLY by a caller that has proven the answer is human — `answer-question`
   * verifies `X-Rapitas-Source` before passing it. Honoured only together
   * with `actor:'user'` on a task still in `awaiting_question`. / 停止の上書きを要求
   */
  stopOverride?: boolean;
  /** 人の回答で旧改訂フラグの上書きを指定する。 */
  resumeImplementer?: boolean;
  operatorAnswer?: true;
  fileApproval?: unknown;
  invalidSelections?: true;
}

const VALID_KINDS = new Set<QuestionKind>([
  'spec_change',
  'execution_continuation',
  'completion_confirmation',
]);

/**
 * Guard 1/4: reject when the task's latest execution is cancelled/a stop is
 * on record. Called twice (before and after the reads below) — a stop may
 * land while those reads are in flight.
 *
 * `allowOverride` opens the one documented escape hatch (task 944). A stop
 * recorded while the task was ALREADY paused on a question seals the pause
 * shut: `isLatestExecutionCancelled` clears only once a newer execution
 * starts, and the scheduler never selects an `awaiting_question` task
 * (`heldAwaitingQuestion`), so no execution can start — both ways out of the
 * pause reject here forever and the task is stuck, invisible. A human
 * answering IS the instruction to continue, so it supersedes the stop; the
 * caller records that it did.
 *
 * @param taskId - Task being answered. / 対象タスク
 * @param override - The answer's actor/override request, when it may claim the escape hatch. / 上書き要求
 * @returns True when a stop was on record and was overridden. / 停止を上書きしたら true
 * @throws {ConflictError} `task_stopping` when a stop is on record and may not be overridden.
 */
export async function assertTaskNotStopping(
  taskId: number,
  override?: Pick<ApplyQuestionAnswerByKindParams, 'actor' | 'stopOverride'>,
): Promise<boolean> {
  if (!(await isLatestExecutionCancelled(taskId))) return false;
  // The task read behind this only happens once a stop is actually on record.
  if (!override || !(await isStopOverrideAllowed(taskId, override))) {
    throw new ConflictError('タスクの実行が停止されています', 'task_stopping');
  }
  log.warn({ taskId }, '[resume-dispatch] human answer supersedes an unresumed stop (task 944)');
  return true;
}

/**
 * Whether this answer is entitled to override an on-record stop.
 *
 * Two conditions, both required. `actor==='user'` keeps the escape hatch away
 * from the unattended auto-answer heal pass, which answers as `system` and
 * must stay subject to the stop. Still being in `awaiting_question` is what
 * makes it the sealed-pause case at all — a task that already advanced out of
 * the pause is not stuck, so its stop still means what it says.
 *
 * @param taskId - Task being answered. / 対象タスク
 * @param params - The answer's actor and whether its caller asked to override. / 回答のactorと上書き要求
 * @returns True when the stop may be overridden. / 上書きを許す場合 true
 */
async function isStopOverrideAllowed(
  taskId: number,
  params: Pick<ApplyQuestionAnswerByKindParams, 'actor' | 'stopOverride'>,
): Promise<boolean> {
  if (params.stopOverride !== true || params.actor !== 'user') return false;
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
    .catch(() => null);
  return task?.workflowStatus === 'awaiting_question';
}

/**
 * Guard 2/4: reject when a NEWER `awaiting_question` pause has superseded
 * the one this call captured (e.g. a heal pass re-paused after the caller
 * read the question).
 *
 * @param taskId - Task being answered. / 対象タスク
 * @param capturedTransitionId - `WorkflowTransition.id` of the pause the caller answered. / 捕捉した遷移ID
 * @throws {ConflictError} `question_outdated` when a newer pause exists.
 */
export async function assertQuestionNotOutdated(
  taskId: number,
  capturedTransitionId: number,
): Promise<void> {
  const latestPause = await prisma.workflowTransition.findFirst({
    where: { taskId, toStatus: 'awaiting_question' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  if (latestPause?.id !== capturedTransitionId) {
    throw new ConflictError('この質問は既に別の質問に置き換わっています', 'question_outdated');
  }
}

/**
 * Guard 3/4: compare-and-swap claim on the pause — only proceed while
 * `task.workflowStatus` is still exactly `awaiting_question`. A concurrent
 * answer landing first flips the affected-row count to 0.
 *
 * @param taskId - Task being answered. / 対象タスク
 * @throws {ConflictError} `question_already_answered` when the CAS touch affects 0 rows.
 */
export async function claimQuestionAnswerSlot(taskId: number): Promise<void> {
  const cas = await prisma.task.updateMany({
    where: { id: taskId, workflowStatus: 'awaiting_question' },
    data: { updatedAt: new Date() },
  });
  if (cas.count === 0) {
    throw questionAlreadyAnswered();
  }
}

function questionAlreadyAnswered(): ConflictError {
  return new ConflictError('この質問は既に回答済みです', 'question_already_answered');
}

/**
 * 改訂の起点と、合わせて選ばれたファイル範囲の拡張を指示に含める。
 *
 * @param match - The matched question/option. / 一致した質問と選択肢
 * @param selected - 選ばれたすべての選択肢
 * @param answer - The raw answer body, if any. / 回答本文
 * @returns The instruction text persisted onto the transition. / 合成した指示文
 */
function composePlanRevisionInstruction(
  match: SelectedOption,
  selected: SelectedOption[],
  answer: string | undefined,
): string {
  const consequencePart = match.option.consequence ? `（${match.option.consequence}）` : '';
  const answerBody = answer && answer.trim() ? answer.trim() : 'なし';
  const additionalScope = selected
    .filter(({ option }) => option !== match.option && requestsFileApproval(option))
    .map(
      ({ question, option }) =>
        `範囲拡張「${question.summary}」の選択: ${option.label}${option.consequence ? `（${option.consequence}）` : ''}。`,
    );
  return (
    `質問「${match.question.summary}」への回答により計画改訂が要求されました。` +
    `選択: ${match.option.label}${consequencePart}。${additionalScope.join('')}回答本文: ${answerBody}`
  );
}

/**
 * 質問待ちを確認し、改訂を既存の状態更新と同じトランザクションで記録する。
 *
 * @param taskId - Task being answered. / 対象タスク
 * @param match - The option that forced the revision. / 改訂の契機の選択肢
 * @param selected - 選ばれたすべての選択肢
 * @param reason - Routing reason recorded on the transition. / 振り分け理由
 * @param answer - The raw answer body, if any. / 回答本文
 * @param sourceLabel - Label describing who/what answered. / 回答元ラベル
 * @returns 改訂への遷移結果。
 */
async function tryRoutePlanRevision(
  taskId: number,
  match: SelectedOption,
  selected: SelectedOption[],
  reason: AnswerRoutingReason,
  answer: string | undefined,
  sourceLabel: string | undefined,
): Promise<{ taskId: number; ok: true; toStatus: WorkflowStatus; kind: QuestionAnswerKind }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { updatedAt: true, workflowStatus: true },
  });
  if (!task) throw new NotFoundError('Task not found');
  if (task.workflowStatus !== 'awaiting_question') throw questionAlreadyAnswered();

  const instruction = composePlanRevisionInstruction(match, selected, answer);
  const source = mapAnswerSourceLabelToRevisionSource(sourceLabel ?? 'ユーザー選択');

  try {
    await persistPlanRevisionCore(prisma, {
      taskId,
      expectedUpdatedAt: task.updatedAt,
      expectedWorkflowStatus: task.workflowStatus,
      instruction,
      source,
      extraMetadata: { routing: 'revision', routingReason: reason },
    });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'P2025')
      throw questionAlreadyAnswered();
    throw err;
  }

  return { taskId, ok: true, toStatus: 'research_done', kind: 'plan_revision' };
}

/**
 * Resolve the currently-pending question's kind and answer it via the
 * strategy that kind maps to.
 *
 * Guards, in order (each rejects with NO state change on failure):
 *  1. {@link assertTaskNotStopping} — 409 `task_stopping`, unless a human
 *     answer claims the task-944 escape hatch (see {@link isStopOverrideAllowed}).
 *  2. No `awaiting_question` transition exists for the task — 404.
 *  3. `kind==='spec_change'` with no `answer` — 400 `ValidationError` (a
 *     resume-from-question caller must never silently treat an unconfirmed
 *     spec change as answered).
 *  4. 選択肢を読んだ後に {@link assertQuestionNotOutdated} — 409 `question_outdated`。
 *  5. {@link assertTaskNotStopping} again (a stop may land while the above
 *     reads were in flight) — 409 `task_stopping`.
 *  6. {@link claimQuestionAnswerSlot} — 409 `question_already_answered`.
 *
 * 改訂を要する回答は `kind:'plan_revision'` を返し、それ以外は質問種別に従う。
 *
 * @param params - Answer to apply. / 適用する回答
 * @returns The task id, resulting status, and the kind that was resolved. / 適用結果
 * @throws {NotFoundError} No pending question is on record for the task.
 * @throws {ValidationError} `spec_change` kind answered with no `answer` text.
 * @throws {ConflictError} One of the competing-answer conditions above.
 */
export function applyQuestionAnswerByKind(params: ApplyQuestionAnswerByKindParams): Promise<{
  taskId: number;
  ok: true;
  toStatus: WorkflowStatus;
  kind: QuestionAnswerKind;
  /** Set when a paused theme had no free slot for the resume (task 1535). / 枠待ち */
  waitingForSlot?: true;
}> {
  return withTaskLifecycleLock(params.taskId, () => applyQuestionAnswerByKindLocked(params));
}

async function applyQuestionAnswerByKindLocked(params: ApplyQuestionAnswerByKindParams): Promise<{
  taskId: number;
  ok: true;
  toStatus: WorkflowStatus;
  kind: QuestionAnswerKind;
  /** Set when a paused theme had no free slot for the resume (task 1535). / 枠待ち */
  waitingForSlot?: true;
}> {
  const { taskId, answer, actor, sourceLabel, selections, extraMetadata } = params;

  let stopOverridden = await assertTaskNotStopping(taskId, params);

  const target = await prisma.workflowTransition.findFirst({
    where: { taskId, toStatus: 'awaiting_question' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, cause: true, fromStatus: true, metadata: true },
  });
  if (!target) {
    throw new NotFoundError('No pending question found for this task');
  }

  const meta = readQuestionMetadata(target.metadata);
  const recordedKind = meta?.kind;
  const kind =
    typeof recordedKind === 'string' && VALID_KINDS.has(recordedKind as QuestionKind)
      ? (recordedKind as QuestionKind)
      : resolveExplicitOrDefaultKind({
          cause: target.cause,
          currentStatus:
            typeof meta?.previousStatus === 'string' ? meta.previousStatus : target.fromStatus,
        });

  // A resume-from-question caller (no answer body) must never silently treat
  // an unconfirmed spec change as answered — reject explicitly instead of
  // falling through to a draft reset with an empty/undefined answer.
  if (kind === 'spec_change' && !answer) {
    throw new ValidationError(
      'この質問は仕様変更(spec_change)です。回答本文なしでは処理できません。' +
        '回答本文付きの answer-question API を使用してください。',
    );
  }

  const dedicated = kind === 'spec_change' || target.cause === 'criteria_review_question';
  const questionContent = dedicated ? null : await readWorkflowFile(taskId, 'question');
  const { selected, hasGrantQuestion, invalid } = matchQuestionSelections(
    questionContent,
    selections,
  );
  await assertQuestionNotOutdated(taskId, target.id);
  // Must take the same override as guard 1. `isLatestExecutionCancelled`
  // cannot tell "the stop guard 1 already saw" from "a stop that landed since"
  // — it answers one boolean about the latest execution. Leaving this one
  // absolute would therefore re-seal the very dead end the override exists to
  // open, for every sealed pause, not just for the mid-answer race.
  stopOverridden = (await assertTaskNotStopping(taskId, params)) || stopOverridden;
  // NOTE: The criteria question's 「推奨の完了条件に書き換える」 writes the
  // rewrite here, before the resume: the planner that runs next must read the
  // new criteria, not the ones the review flagged (asked 2026-11-20).
  const human = actor === 'user';
  const decision = decideAnswerRouting(selected, {
    human,
    resumeImplementer: params.resumeImplementer,
  });
  if (
    !dedicated &&
    (hasGrantQuestion || params.fileApproval !== undefined) &&
    (invalid || params.invalidSelections || decision.route === 'reject')
  ) {
    throw new ValidationError('現在の質問の選択肢とファイル許可を確認してください');
  }
  let planGrant;
  if (
    decision.route === 'grant' ||
    (decision.route === 'revision' && decision.requiresFileApproval)
  ) {
    if (!human || !params.operatorAnswer || !answer || !questionContent) {
      throw new ValidationError('運用者による署名付きのファイル許可が必要です');
    }
    planGrant = await preparePlanScopeGrant({
      taskId,
      answer,
      questionContent,
      questionTransitionId: target.id,
      pairs: selected.map(({ question, option }) => [question.id, option.key]),
      proposal: selected.flatMap(({ option }) => option.grantsFiles ?? []),
      resumeImplementer: params.resumeImplementer,
      approval: params.fileApproval,
    });
    await assertQuestionNotOutdated(taskId, target.id);
    stopOverridden = (await assertTaskNotStopping(taskId, params)) || stopOverridden;
  } else if (!dedicated && params.fileApproval !== undefined && decision.route === 'resume') {
    throw new ValidationError('ファイル許可を求める選択肢を指定してください');
  }
  if (decision.route !== 'grant') {
    await claimQuestionAnswerSlot(taskId);
  }
  if (target.cause === 'criteria_review_question') {
    const { applyCriteriaReviewSelection } =
      await import('../../../services/workflow/research-criteria-review');
    await applyCriteriaReviewSelection(taskId, meta, selections);
  }
  if (decision.route === 'revision') {
    return tryRoutePlanRevision(
      taskId,
      decision.trigger,
      selected,
      decision.reason,
      answer,
      sourceLabel,
    );
  }

  // Audit trail: the escape hatch (a stop still on record), and which way the
  // answer was routed and why (task 1546).
  const overrideMetadata = {
    ...(stopOverridden ? { stopOverridden: true } : {}),
    routing: 'resume',
    routingReason: decision.reason,
  };

  const strategy = resolveQuestionAnswerStrategy(kind);
  if (strategy === 'reset_draft') {
    // Guaranteed non-empty here — the spec_change/no-answer combination was
    // already rejected above, and reset_draft only ever maps from spec_change.
    const result = await applyIntakeQuestionAnswerLocked({
      taskId,
      answer: answer as string,
      actor,
      sourceLabel: sourceLabel ?? 'answer-question',
      selections,
      // Intake answers reset to draft; the plan-routing audit does not apply.
      extraMetadata: {
        ...(extraMetadata ?? {}),
        kind,
        ...(stopOverridden ? { stopOverridden: true } : {}),
      },
    });
    return { ...result, kind };
  }

  const result = await applyResumeFromQuestionAnswerLocked({
    taskId,
    actor,
    answer,
    ...(planGrant ? { planGrant } : {}),
    recheckCompletionGate: strategy === 'resume_previous_no_gate',
    extraMetadata: {
      ...(extraMetadata ?? {}),
      kind,
      ...(sourceLabel ? { sourceLabel } : {}),
      ...overrideMetadata,
    },
  });
  return { taskId: result.taskId, ok: true, toStatus: result.toStatus, kind };
}

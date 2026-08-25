/**
 * Workflow Handlers / Resume
 *
 * `awaiting_question` 状態から、保存された previousStatus に復帰する API ハンドラ。
 * question.md がユーザーによって解消（回答記入 or 削除）された後、エージェント実行を
 * 再開させるために呼ばれる。
 */

import { prisma } from '../../../config';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import { ValidationError, NotFoundError } from '../../../middleware/error-handler';
import { createLogger } from '../../../config';
import type { WorkflowStatus } from '../../../services/workflow/workflow-types';
import { resolveTaskWorkflowState } from '../../../services/task/task-resolver';
import {
  archiveWorkflowFile,
  readWorkflowFile,
  writeWorkflowFile,
} from '../../../services/workflow/workflow-file-utils';

const log = createLogger('routes:workflow:resume');

/**
 * Best-effort auto re-trigger after an intake question is answered.
 *
 * This pause never had a live agent process to resume (see
 * handleAnswerWorkflowQuestion's doc comment) — without this, a manually
 * executed task (auto-run disabled for its theme) just sat at
 * workflowStatus='draft' forever, needing the user to notice and click
 * "実行" again themselves. That silently contradicted the frontend's own
 * phase-completion message, which always claims "次のフェーズへ自動で進みます"
 * for the researcher phase regardless of whether it ended in a question.
 *
 * Reuses the SAME agent config the task's last execution used (falls back to
 * the execute route's own default-agent resolution when none is found).
 * Never throws — errors are logged and swallowed so a failed auto re-run
 * cannot fail the caller's own response; a theme with auto-run currently
 * active will reject this with 409 (harmless — the scheduler already owns
 * that task).
 *
 * @param taskId - Task whose question was just answered. / 回答されたタスクID
 */
async function triggerReExecutionAfterAnswer(taskId: number): Promise<void> {
  try {
    // NOTE: A task run through the workflow CLI executor (research/plan/verify
    // phases) never gets an AgentExecution row via this session→config chain —
    // that relation is populated by a different execution path. Task 513
    // (research already ran, a mid-research question paused it, answered,
    // never resumed) had zero AgentExecution rows despite research.md
    // existing, proving lastExecution is null for exactly the common case
    // this function exists to handle. Previously this returned early here,
    // silently skipping the re-run entirely — contradicting this function's
    // own doc comment, which already promised execute-route's default-agent
    // resolution as the fallback. Proceed with agentConfigId left undefined
    // instead so that fallback actually runs.
    const lastExecution = await prisma.agentExecution.findFirst({
      where: { session: { config: { taskId } } },
      orderBy: { createdAt: 'desc' },
      select: { agentConfigId: true },
    });
    if (!lastExecution) {
      log.info(
        { taskId },
        '[Workflow:Answer] No prior execution found for this task — re-running with the default agent config',
      );
    }

    const port = process.env.PORT || '3001';
    const apiToken = process.env.RAPITAS_API_TOKEN;
    const res = await fetch(`http://127.0.0.1:${port}/tasks/${taskId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({ agentConfigId: lastExecution?.agentConfigId ?? undefined }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn(
        { taskId, status: res.status, body },
        '[Workflow:Answer] Auto re-run request was rejected — task remains draft until manually re-run',
      );
      return;
    }
    log.info({ taskId }, '[Workflow:Answer] Auto re-run triggered after question answer');
  } catch (err) {
    log.warn({ err, taskId }, '[Workflow:Answer] Auto re-run trigger failed (non-fatal)');
  }
}

interface ResumeContext {
  params: { taskId: string };
  body?: unknown;
  set: { status?: number };
}

interface AnswerContext {
  params: { taskId: string };
  body?: { answer?: string; selections?: unknown } | unknown;
  set: { status?: number };
  headers?: Record<string, string | undefined>;
}

/** Callers permitted to answer a spec question, and how each is labelled. */
const ANSWER_SOURCE_LABELS: Record<string, string> = {
  ui: 'ユーザー選択',
  operator: 'オペレーター代理回答',
};

/** One question's audit record: which option (if any) the user picked. */
interface AnswerSelection {
  questionId: string;
  selectedKey: string | null;
}

/**
 * Defensively parse the optional `selections` audit payload from a
 * structured (`json:options`) answer. Malformed/absent input yields
 * `undefined` rather than throwing — `selections` is an audit nicety, never
 * required to apply the answer itself (the `answer` string is authoritative).
 *
 * @param raw - The `selections` field from the request body, unvalidated. / 未検証の selections
 * @returns Parsed selections, or undefined when absent/empty/invalid. / パース結果
 */
function parseSelections(raw: unknown): AnswerSelection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AnswerSelection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.questionId !== 'string' || !o.questionId.trim()) continue;
    out.push({
      questionId: o.questionId,
      selectedKey: typeof o.selectedKey === 'string' ? o.selectedKey : null,
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Apply a user's free-text / choice answer to a workflow QUESTION (the intake
 * quality gate's `question.md` asking for goals/constraints/acceptance, or any
 * spec-clarification question). The answer is appended to the task description as
 * a 仕様補足 section AND seeded into the structured `goals` field so the intake
 * gate sees a non-empty spec instead of re-asking; question.md is archived and the
 * workflow is reset to `draft` so research re-runs with the enrichment.
 *
 * Without this, an intake `question.md` was displayed in the Q&A tab but had no
 * answer path (the interactive panel only handled live mid-execution questions),
 * so the user could not actually answer the agent.
 *
 * @param ctx - Elysia handler context with { answer, selections? } body. / 回答ボディ
 * @returns The task id and the status it was reset to. / 反映後の状態
 * @throws {ValidationError} taskId 不正 / answer 未指定
 * @throws {NotFoundError} タスクが見つからない場合
 */
export async function handleAnswerWorkflowQuestion({
  params,
  body,
  set,
  headers,
}: AnswerContext): Promise<{
  taskId: number;
  ok: true;
  toStatus: WorkflowStatus;
}> {
  const taskId = parseInt(params.taskId, 10);
  if (Number.isNaN(taskId)) {
    set.status = 400;
    throw new ValidationError('Invalid taskId');
  }

  // A spec question is a decision the WORKFLOW is not entitled to make for
  // itself. Task 662 asked whether its 「視覚的に区別できる」 acceptance criterion
  // could be met with no UI, then answered itself 「UI追加なし」 through a shell
  // curl — and the archive recorded it as 「ユーザー選択」. The verifier then
  // correctly failed that criterion twice (it says 視覚的に; the diff had no UI)
  // and the task blocked on non-convergence. The escalation was right; the
  // scope waiver behind it was never granted by anyone.
  //
  // Mirrors the guard on PUT /tasks/:id/status (workflow-handlers-plan.ts):
  // server-internal callers never go through HTTP, so legitimate traffic here
  // always carries the header.
  const rawSource = headers?.['x-rapitas-source'];
  const answerSource = typeof rawSource === 'string' ? rawSource.toLowerCase() : '';
  if (!ANSWER_SOURCE_LABELS[answerSource]) {
    log.warn(
      { taskId, source: rawSource ?? null, ua: headers?.['user-agent'] ?? null },
      '[Workflow:Answer] Rejected spec answer: missing X-Rapitas-Source header (likely an agent shell-call)',
    );
    await recordTransition({
      taskId,
      fromStatus: null,
      toStatus: 'awaiting_question',
      actor: 'system',
      cause: 'spec_answer_blocked',
      metadata: { reason: 'missing X-Rapitas-Source header', source: rawSource ?? null },
      invariantViolation: true,
      invariantMessage: 'Agent attempted to answer its own spec question',
    }).catch(() => {});
    set.status = 400;
    throw new ValidationError(
      '仕様質問への回答には X-Rapitas-Source ヘッダ(ui|operator)が必要です。' +
        'エージェントが自身の仕様質問に回答することは許可されていません。',
    );
  }

  const answer =
    typeof (body as { answer?: string })?.answer === 'string'
      ? (body as { answer: string }).answer.trim()
      : '';
  if (!answer) {
    set.status = 400;
    throw new ValidationError('answer is required');
  }
  const selections = parseSelections((body as { selections?: unknown })?.selections);

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, description: true, goals: true, workflowStatus: true, status: true },
  });
  if (!task) {
    set.status = 404;
    throw new NotFoundError('Task not found');
  }

  // Seed the structured goals so the intake gate sees a non-empty spec (else it
  // re-asks the same question on the re-run).
  let goals: string[] = [];
  try {
    const parsed = JSON.parse(task.goals ?? '[]');
    if (Array.isArray(parsed)) goals = parsed.filter((g): g is string => typeof g === 'string');
  } catch {
    /* malformed goals JSON — start fresh */
  }
  if (!goals.includes(answer)) goals.push(answer);

  const clarified =
    `${task.description ?? ''}\n\n## 仕様補足（${ANSWER_SOURCE_LABELS[answerSource]}）\n${answer}`.trim();

  // This intake pause never had a live agent session (question.md was saved
  // then the process exited) — the researcher's own execution loop
  // misreported that pause as a phase failure, which left task.status
  // stuck at 'blocked' (see workflow-cli-executor.ts's awaiting_question
  // handling). Answering only resets workflowStatus; without also clearing
  // a stale 'blocked' here, the task stays permanently unschedulable even
  // after the user answers (WorkflowOrchestrator refuses to advance any
  // 'blocked' task). Only touch it when 'blocked' — never override a
  // status set for an unrelated reason.
  const statusUpdate = task.status === 'blocked' ? { status: 'todo' as const } : {};

  await prisma.task.update({
    where: { id: taskId },
    data: {
      description: clarified,
      goals: JSON.stringify(goals),
      workflowStatus: 'draft',
      updatedAt: new Date(),
      ...statusUpdate,
    },
  });

  // Append the user's answer to question.md BEFORE archiving, so the archived
  // WorkflowFileVersion keeps an audit trail of what was actually answered
  // (writeWorkflowFile itself moves the pre-append content into
  // WorkflowFileVersion, then archiveWorkflowFile moves the appended version
  // there too — archiveWorkflowFile's own signature is unchanged).
  const questionContent = await readWorkflowFile(taskId, 'question');
  if (questionContent != null) {
    const answerBlock = `\n\n## 回答（${ANSWER_SOURCE_LABELS[answerSource]}）\n${answer}`;
    await writeWorkflowFile(taskId, 'question', `${questionContent}${answerBlock}`).catch(() => {});
  }

  // Archive question.md so it is no longer a pending question.
  await archiveWorkflowFile(taskId, 'question').catch(() => {});

  // The plan was derived from the spec as it stood BEFORE this answer, so it
  // now contradicts it. Archive it too and let the planner regenerate.
  //
  // Task 662 is what this costs otherwise: an operator answer widened the scope
  // to include a UI card, the implementer built exactly that, and the
  // adversarial reviewer — which reads plan.md, not the task description —
  // rejected the diff four times in a row for violating the stale plan's
  // 「非対象（やらないこと）: UIカードの新規追加」. The planner tried to rewrite it
  // and was refused (`transition_rejected`: plan is not an allowed file type at
  // plan_approved), so nothing could break the loop. Keeping the plan is not
  // even the cheap option: one planner re-run cost ~$1 on that task, the four
  // wasted implement+verify cycles cost ~$8.
  //
  // Unconditional on purpose. Detecting whether an answer 'materially' changes
  // scope is the same kind of guess that keeps being wrong; regenerating one
  // cheap phase is the reliable option.
  await archiveWorkflowFile(taskId, 'plan').catch(() => {});

  await recordTransition({
    taskId,
    fromStatus: (task.workflowStatus as WorkflowStatus) ?? 'draft',
    toStatus: 'draft',
    actor: 'user',
    cause: 'intake_question_answered',
    metadata: selections ? { selections } : {},
  });

  log.info(
    { taskId },
    '[Workflow:Answer] Recorded user answer to workflow question; reset to draft',
  );

  // Errors are logged inside triggerReExecutionAfterAnswer and never thrown —
  // a failed auto re-run must not fail this response (the answer itself is
  // already durably recorded above; the user can still re-run manually).
  await triggerReExecutionAfterAnswer(taskId);

  return { taskId, ok: true, toStatus: 'draft' };
}

/**
 * `awaiting_question` 状態のタスクを、質問発生前の status に復帰させる。
 *
 * 復帰先 status は `WorkflowTransition` の最新 `to_status='awaiting_question'`
 * 行の `metadata.previousStatus` から取得する。metadata に値が無い古い遷移は
 * `in_progress` を fallback に使う。
 *
 * @param ctx - Elysia ハンドラコンテキスト
 * @returns 新しい workflowStatus と復帰先の根拠 / 復帰した状態オブジェクト
 * @throws {ValidationError} taskId が不正、または status が awaiting_question でない場合
 * @throws {NotFoundError} タスクが見つからない場合
 */
export async function handleResumeFromQuestion({ params, set }: ResumeContext): Promise<{
  taskId: number;
  fromStatus: WorkflowStatus;
  toStatus: WorkflowStatus;
  source: 'transition_metadata' | 'fallback';
}> {
  const taskId = parseInt(params.taskId, 10);
  if (Number.isNaN(taskId)) {
    set.status = 400;
    throw new ValidationError('Invalid taskId');
  }

  const task = await resolveTaskWorkflowState(taskId);
  if (!task) {
    set.status = 404;
    throw new NotFoundError('Task not found');
  }

  if (task.workflowStatus !== 'awaiting_question') {
    set.status = 400;
    throw new ValidationError(
      `Cannot resume: task ${taskId} is in status "${task.workflowStatus}", expected "awaiting_question"`,
    );
  }

  // 直近の awaiting_question 遷移ログから previousStatus を読み出す
  const lastWaitingTransition = await prisma.workflowTransition.findFirst({
    where: { taskId, toStatus: 'awaiting_question' },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true, fromStatus: true },
  });

  let resumeStatus: WorkflowStatus = 'in_progress';
  let source: 'transition_metadata' | 'fallback' = 'fallback';
  if (lastWaitingTransition?.metadata) {
    // Prisma's Json field is typed as string|number|boolean|object|array. Narrow via unknown.
    const meta = lastWaitingTransition.metadata as unknown as Record<string, unknown>;
    const prev = meta.previousStatus;
    if (typeof prev === 'string' && prev !== 'awaiting_question') {
      resumeStatus = prev as WorkflowStatus;
      source = 'transition_metadata';
    } else if (lastWaitingTransition.fromStatus) {
      // metadata 欠落でも fromStatus が残っていれば優先する
      resumeStatus = lastWaitingTransition.fromStatus as WorkflowStatus;
      source = 'transition_metadata';
    }
  }

  log.info(
    `[Workflow:Resume] Task ${taskId}: awaiting_question → ${resumeStatus} (source=${source})`,
  );

  await prisma.task.update({
    where: { id: taskId },
    data: { workflowStatus: resumeStatus, updatedAt: new Date() },
  });

  await recordTransition({
    taskId,
    fromStatus: 'awaiting_question',
    toStatus: resumeStatus,
    actor: 'user',
    cause: 'question_resolved',
    metadata: { source },
  });

  return {
    taskId,
    fromStatus: 'awaiting_question',
    toStatus: resumeStatus,
    source,
  };
}

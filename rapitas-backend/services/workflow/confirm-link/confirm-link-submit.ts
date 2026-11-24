/**
 * confirm-link-submit
 *
 * Accepts the one A/B answer a confirm link allows (task 1430). The audit
 * line is written BEFORE the answer is applied: any write after the apply
 * can fail, so writing first is the only order that never leaves an applied
 * answer without its audit (acceptance criterion 4). The line is removed
 * again only when the answer is known not to have been applied; a lost
 * removal is cleaned up by the next prune. Never takes the task lifecycle
 * lock — applyAnswer does, and it is not re-entrant.
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../../config/logger';
import { AppError } from '../../../middleware/error-handler';
import { confirmLinkRoute, type ConfirmLinkAuditEntry } from './confirm-link-audit';
import { composeLinkAnswer, normalizeRespondentName } from './confirm-link-question';
import { GONE, isStillPending, resolveLink } from './confirm-link-resolve';
import { CONFIRM_LINK_SOURCE_LABEL, loadConfirmLinkView } from './confirm-link-service';
import type { ConfirmLinkRecord } from './confirm-link-store';
import type { ConfirmLinkPageResult, ConfirmLinkServiceDeps } from './confirm-link-types';

const log = createLogger('confirm-link-submit');

const FORM_ERROR = '選択肢・お名前（50文字以内）・確認のチェックをすべて入力してください';

/** Input of {@link submitConfirmLinkAnswer}. */
export interface ConfirmLinkSubmitInput {
  token: string;
  choice: unknown;
  respondentName: unknown;
  confirmed: boolean;
  now: number;
}

/**
 * Undo the audit line for an answer that was not applied. A failure is only
 * logged: the line's link is `active` or `revoked`, so the next prune drops it.
 */
async function compensateAudit(
  auditId: string,
  linkId: string,
  deps: ConfirmLinkServiceDeps,
): Promise<void> {
  await deps.removeAudit(auditId).catch((err) => {
    log.error({ err, linkId, auditId }, '[confirm-link] audit compensation failed; left to prune');
  });
}

/**
 * Settle a failed apply. A 409/404 from the dispatcher's guards means nothing
 * changed. Any other error is ambiguous, so the task is re-read: only a
 * question still waiting proves the answer was not applied.
 */
async function settleApplyFailure(
  err: unknown,
  record: ConfirmLinkRecord,
  auditId: string,
  deps: ConfirmLinkServiceDeps,
): Promise<ConfirmLinkPageResult> {
  if (err instanceof AppError && (err.statusCode === 409 || err.statusCode === 404)) {
    await compensateAudit(auditId, record.linkId, deps);
    await deps.store.revoke(record.linkId, err.code ?? 'answer_conflict');
    return err.code === 'task_stopping' ? { status: 409, kind: 'gone' } : GONE;
  }

  log.error({ err, linkId: record.linkId }, '[confirm-link] applying the answer failed');
  let stillPending = false;
  try {
    stillPending = (await isStillPending(record, deps)) !== null;
  } catch (readErr) {
    log.error(
      { err: readErr, linkId: record.linkId },
      '[confirm-link] re-read after failure failed',
    );
  }
  if (stillPending) {
    await compensateAudit(auditId, record.linkId, deps);
    await deps.store.release(record.linkId);
    return { status: 500, kind: 'error' };
  }
  // The answer may have been applied: keep the audit and leave the link
  // `answering` (consumed). Deleting the line could break criterion 4.
  return { status: 500, kind: 'error', uncertain: true };
}

/**
 * Accept the one answer a link allows.
 *
 * @param input - Token, chosen key, self-reported name, confirmation, time / 送信内容
 * @param deps - Collaborators / 依存
 * @returns The answered page, a form error, or a rejection / 結果
 */
export async function submitConfirmLinkAnswer(
  input: ConfirmLinkSubmitInput,
  deps: ConfirmLinkServiceDeps,
): Promise<ConfirmLinkPageResult> {
  const record = await resolveLink(input.token, input.now, deps);
  if ('kind' in record) return record;
  if (record.state !== 'active') return GONE;

  const name = normalizeRespondentName(input.respondentName);
  const choice = typeof input.choice === 'string' ? input.choice : '';
  if (!name || !input.confirmed || !record.optionKeys.includes(choice)) {
    const view = await loadConfirmLinkView({ token: input.token, now: input.now }, deps);
    if (view.kind !== 'form') return view;
    return { status: 400, kind: 'form', view: view.view, error: FORM_ERROR };
  }

  await deps.pruneOrphanAudits(record.taskId).catch((err) => {
    log.warn({ err, taskId: record.taskId }, '[confirm-link] orphan audit prune failed');
  });
  if (!(await deps.store.reserve(record.linkId, input.now))) return GONE;

  let question: Awaited<ReturnType<typeof isStillPending>>;
  try {
    question = await isStillPending(record, deps);
  } catch (err) {
    log.error({ err, linkId: record.linkId }, '[confirm-link] reading the task failed');
    await deps.store.release(record.linkId);
    return { status: 500, kind: 'error' };
  }
  const answer = question ? composeLinkAnswer(question, choice) : null;
  if (!question || !answer) {
    await deps.store.revoke(record.linkId, 'question_resolved_internally');
    return GONE;
  }

  const route = confirmLinkRoute(record.linkId);
  const entry: ConfirmLinkAuditEntry = {
    id: randomUUID(),
    at: new Date(input.now).toISOString(),
    linkId: record.linkId,
    taskId: record.taskId,
    pauseTransitionId: record.pauseTransitionId,
    questionId: record.questionId,
    selectedKey: choice,
    respondentName: name,
    route,
    questionDigest: record.questionDigest,
  };
  try {
    await deps.appendAudit(entry);
  } catch (err) {
    log.error({ err, linkId: record.linkId }, '[confirm-link] audit write failed; answer refused');
    await deps.store.release(record.linkId);
    return { status: 503, kind: 'unavailable' };
  }

  let kind: string;
  try {
    ({ kind } = await deps.applyAnswer({
      taskId: record.taskId,
      answer,
      actor: 'user',
      sourceLabel: CONFIRM_LINK_SOURCE_LABEL,
      selections: [{ questionId: record.questionId, selectedKey: choice }],
      expectedPauseTransitionId: record.pauseTransitionId,
      expectedQuestionDigest: record.questionDigest,
      extraMetadata: { route, linkId: record.linkId },
    }));
  } catch (err) {
    return settleApplyFailure(err, record, entry.id, deps);
  }

  // `answering` already refuses a resend and satisfies the audit invariant,
  // so a failed transition to `answered` does not undo the accepted answer.
  await deps.store.markAnswered(record.linkId, input.now).catch((err) => {
    log.error({ err, linkId: record.linkId }, '[confirm-link] markAnswered failed');
  });
  await deps.releaseHalt(record.taskId, answer, CONFIRM_LINK_SOURCE_LABEL).catch(() => false);
  if (kind === 'plan_revision') await deps.triggerReExecution(record.taskId);

  const selectedLabel = question.options.find((o) => o.key === choice)?.label ?? choice;
  return { status: 200, kind: 'answered', selectedLabel };
}

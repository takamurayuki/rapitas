/**
 * confirm-link-service
 *
 * Issues an external confirm link for one blocked question, builds the data
 * its public page shows, and accepts the one A/B answer it allows (task 1430).
 * Every collaborator is injected, so this module never takes the task
 * lifecycle lock itself — applyAnswer does, and that lock is not re-entrant.
 * Not responsible for HTTP or HTML.
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../../config/logger';
import { AppError } from '../../../middleware/error-handler';
import { confirmLinkRoute } from './confirm-link-audit';
import {
  composeLinkAnswer,
  normalizeRespondentName,
  resolveLinkableQuestion,
} from './confirm-link-question';
import {
  getPublicResource,
  listPublicResources,
  type ConfirmLinkResourceRow,
} from './confirm-link-resources';
import type { ConfirmLinkRecord } from './confirm-link-store';
import {
  CONFIRM_LINK_TTL_MS,
  generateConfirmLinkId,
  signConfirmLinkToken,
  verifyConfirmLinkToken,
} from './confirm-link-token';
import {
  ConfirmLinkError,
  type ConfirmLinkPageResult,
  type ConfirmLinkServiceDeps,
} from './confirm-link-types';

export * from './confirm-link-types';

const log = createLogger('confirm-link-service');

/** Label recorded on the answer and its transition. */
export const CONFIRM_LINK_SOURCE_LABEL = '外部確認リンク';
const MAX_MESSAGE_LENGTH = 2000;

const NOT_FOUND = { status: 404, kind: 'not_found' } as const;
const GONE = { status: 410, kind: 'gone' } as const;

/**
 * Issue a link for the task's pending question, revoking any earlier link.
 *
 * @param input - Task, optional request text, current time / 対象タスク・依頼文・現在時刻
 * @param deps - Collaborators / 依存
 * @returns Link id, URL and expiry / リンクID・URL・失効時刻
 * @throws {ConfirmLinkError} 409 disabled, 404 task, 400 message, 422 ineligible question
 */
export async function issueConfirmLink(
  input: { taskId: number; message?: string; now: number },
  deps: ConfirmLinkServiceDeps,
): Promise<{ linkId: string; url: string; expiresAt: number; relative: boolean }> {
  if (!deps.secret) {
    throw new ConfirmLinkError(
      409,
      'confirm_link_disabled',
      'RAPITAS_CONFIRM_LINK_SECRET is not set',
    );
  }
  const message = (input.message ?? '').trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ConfirmLinkError(400, 'confirm_link_message_too_long', '依頼文は2000文字以内です');
  }
  const snapshot = await deps.readTaskSnapshot(input.taskId);
  if (!snapshot) throw new ConfirmLinkError(404, 'task_not_found', 'タスクが見つかりません');
  const linkable = resolveLinkableQuestion(await deps.readQuestion(input.taskId));
  if (snapshot.workflowStatus !== 'awaiting_question' || !snapshot.latestPauseId || !linkable.ok) {
    const reason = linkable.ok ? 'not_awaiting_question' : linkable.reason;
    throw new ConfirmLinkError(422, 'confirm_link_ineligible', reason);
  }

  const linkId = generateConfirmLinkId();
  const expiresAt = input.now + CONFIRM_LINK_TTL_MS;
  await deps.store.issue(
    {
      linkId,
      taskId: input.taskId,
      pauseTransitionId: snapshot.latestPauseId,
      questionId: linkable.question.id,
      optionKeys: linkable.question.options.map((o) => o.key),
      message,
      issuedAt: input.now,
      expiresAt,
      state: 'active',
    },
    input.now,
  );
  const path = `/public/confirm-links/${signConfirmLinkToken({ linkId, expiresAt }, deps.secret)}`;
  const origin = deps.publicOrigin?.replace(/\/+$/, '') ?? '';
  return { linkId, url: `${origin}${path}`, expiresAt, relative: !origin };
}

/** Signature first, then the store: a forged token never reaches a lookup. */
async function resolveLink(
  token: string,
  now: number,
  deps: ConfirmLinkServiceDeps,
): Promise<ConfirmLinkRecord | typeof NOT_FOUND | typeof GONE> {
  if (!deps.secret) return NOT_FOUND;
  const verified = verifyConfirmLinkToken(token, deps.secret, now);
  if (!verified.ok) return verified.reason === 'expired' ? GONE : NOT_FOUND;
  const record = await deps.store.get(verified.linkId);
  if (!record) return GONE;
  return record;
}

/** The question is still the one the link captured and still unanswered. */
async function isStillPending(record: ConfirmLinkRecord, deps: ConfirmLinkServiceDeps) {
  const snapshot = await deps.readTaskSnapshot(record.taskId);
  if (snapshot?.workflowStatus !== 'awaiting_question') return null;
  if (snapshot.latestPauseId !== record.pauseTransitionId) return null;
  const linkable = resolveLinkableQuestion(await deps.readQuestion(record.taskId));
  return linkable.ok && linkable.question.id === record.questionId ? linkable.question : null;
}

/**
 * Build the public page data for a token.
 *
 * @param input - Token and current time / トークンと現在時刻
 * @param deps - Collaborators / 依存
 * @returns The form view, or a rejection / 表示データまたは拒否
 */
export async function loadConfirmLinkView(
  input: { token: string; now: number },
  deps: ConfirmLinkServiceDeps,
): Promise<ConfirmLinkPageResult> {
  const record = await resolveLink(input.token, input.now, deps);
  if ('kind' in record) return record;
  if (record.state !== 'active') return GONE;
  const question = await isStillPending(record, deps);
  if (!question) {
    await deps.store.revoke(record.linkId, 'question_resolved_internally');
    return GONE;
  }
  return {
    status: 200,
    kind: 'form',
    view: {
      message: record.message,
      summary: question.summary,
      options: question.options.map((o) => ({
        key: o.key,
        label: o.label,
        consequence: o.consequence,
      })),
      resources: await listPublicResources(record.taskId, deps),
      expiresAt: record.expiresAt,
    },
  };
}

/**
 * Find a resource the link's page may serve: the link must still be usable
 * and the resource must be in the task's public set.
 *
 * @param input - Token, requested resource id, current time / トークン・資料ID・現在時刻
 * @param deps - Collaborators / 依存
 * @returns The resource row, or null / 資料、配信不可なら null
 */
export async function findConfirmLinkResource(
  input: { token: string; resourceId: number; now: number },
  deps: ConfirmLinkServiceDeps,
): Promise<ConfirmLinkResourceRow | null> {
  const record = await resolveLink(input.token, input.now, deps);
  if ('kind' in record || record.state !== 'active') return null;
  if (!(await isStillPending(record, deps))) return null;
  return getPublicResource(record.taskId, input.resourceId, deps);
}

/**
 * Accept the one answer a link allows.
 *
 * @param input - Token, chosen key, self-reported name, confirmation, time / 送信内容
 * @param deps - Collaborators / 依存
 * @returns The answered page, a form error, or a rejection / 結果
 */
export async function submitConfirmLinkAnswer(
  input: {
    token: string;
    choice: unknown;
    respondentName: unknown;
    confirmed: boolean;
    now: number;
  },
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
    const error = '選択肢・お名前（50文字以内）・確認のチェックをすべて入力してください';
    return { status: 400, kind: 'form', view: view.view, error };
  }

  if (!(await deps.store.reserve(record.linkId, input.now))) return GONE;
  const question = await isStillPending(record, deps);
  const answer = question ? composeLinkAnswer(question, choice) : null;
  if (!question || !answer) {
    await deps.store.revoke(record.linkId, 'question_resolved_internally');
    return GONE;
  }

  const route = confirmLinkRoute(record.linkId);
  let kind: string;
  try {
    ({ kind } = await deps.applyAnswer({
      taskId: record.taskId,
      answer,
      actor: 'user',
      sourceLabel: CONFIRM_LINK_SOURCE_LABEL,
      selections: [{ questionId: record.questionId, selectedKey: choice }],
      expectedPauseTransitionId: record.pauseTransitionId,
      extraMetadata: { route, linkId: record.linkId },
    }));
  } catch (err) {
    if (err instanceof AppError && (err.statusCode === 409 || err.statusCode === 404)) {
      await deps.store.revoke(record.linkId, err.code ?? 'answer_conflict');
      return err.code === 'task_stopping' ? { status: 409, kind: 'gone' } : GONE;
    }
    log.error({ err, linkId: record.linkId }, '[confirm-link] applying the answer failed');
    await deps.store.release(record.linkId);
    return { status: 500, kind: 'error' };
  }

  await deps.store.markAnswered(record.linkId, input.now);
  await deps
    .appendAudit({
      id: randomUUID(),
      at: new Date(input.now).toISOString(),
      linkId: record.linkId,
      taskId: record.taskId,
      pauseTransitionId: record.pauseTransitionId,
      questionId: record.questionId,
      selectedKey: choice,
      respondentName: name,
      route,
    })
    // The transition's extraMetadata still carries route + linkId to rebuild this from.
    .catch((err) => log.warn({ err, linkId: record.linkId }, '[confirm-link] audit append failed'));
  await deps.releaseHalt(record.taskId, answer, CONFIRM_LINK_SOURCE_LABEL).catch(() => false);
  if (kind === 'plan_revision') await deps.triggerReExecution(record.taskId);

  const selectedLabel = question.options.find((o) => o.key === choice)?.label ?? choice;
  return { status: 200, kind: 'answered', selectedLabel };
}

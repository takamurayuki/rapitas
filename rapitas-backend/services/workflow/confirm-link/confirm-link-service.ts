/**
 * confirm-link-service
 *
 * Issues an external confirm link for one blocked question and builds the
 * data its public page shows (task 1430). Accepting the answer lives in
 * confirm-link-submit.ts. Every collaborator is injected. Not responsible for
 * HTTP or HTML.
 */
import { createLogger } from '../../../config/logger';
import { computeQuestionDigest, resolveLinkableQuestion } from './confirm-link-question';
import { GONE, isStillPending, resolveLink } from './confirm-link-resolve';
import {
  getPublicResource,
  listPublicResources,
  type ConfirmLinkResourceRow,
} from './confirm-link-resources';
import {
  CONFIRM_LINK_TTL_MS,
  generateConfirmLinkId,
  signConfirmLinkToken,
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
  const content = await deps.readQuestion(input.taskId);
  const linkable = resolveLinkableQuestion(content);
  if (snapshot.workflowStatus !== 'awaiting_question' || !snapshot.latestPauseId || !linkable.ok) {
    const reason = linkable.ok ? 'not_awaiting_question' : linkable.reason;
    throw new ConfirmLinkError(422, 'confirm_link_ineligible', reason);
  }

  // Lost audit compensations of this task are cleaned before a new link exists.
  await deps.pruneOrphanAudits(input.taskId).catch((err) => {
    log.warn({ err, taskId: input.taskId }, '[confirm-link] orphan audit prune failed');
  });
  const linkId = generateConfirmLinkId();
  const expiresAt = input.now + CONFIRM_LINK_TTL_MS;
  await deps.store.issue(
    {
      linkId,
      taskId: input.taskId,
      pauseTransitionId: snapshot.latestPauseId,
      questionId: linkable.question.id,
      optionKeys: linkable.question.options.map((o) => o.key),
      questionDigest: computeQuestionDigest(content ?? ''),
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
    await deps.store.revokeIfActive(record.linkId, 'question_resolved_internally');
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

/**
 * confirm-link-resolve
 *
 * Shared lookups of the confirm-link flow (task 1430): turn a token into its
 * link record (signature first, store second) and decide whether the
 * question the link captured is still the pending one — same pause, same
 * question id and the same question.md version. Used by both the view and
 * the answer paths, which is why it lives apart from either.
 */
import type { ParsedQuestion } from '../question-options-parser';
import { computeQuestionDigest, resolveLinkableQuestion } from './confirm-link-question';
import type { ConfirmLinkRecord } from './confirm-link-store';
import { verifyConfirmLinkToken } from './confirm-link-token';
import type { ConfirmLinkServiceDeps } from './confirm-link-types';

export const NOT_FOUND = { status: 404, kind: 'not_found' } as const;
export const GONE = { status: 410, kind: 'gone' } as const;

/**
 * Resolve a token to its link. A forged token never reaches the store.
 *
 * @param token - Token from the URL / URL 内のトークン
 * @param now - Current epoch ms / 現在時刻
 * @param deps - Collaborators / 依存
 * @returns The record, or a 404 / 410 result / リンク記録または拒否
 */
export async function resolveLink(
  token: string,
  now: number,
  deps: Pick<ConfirmLinkServiceDeps, 'secret' | 'store'>,
): Promise<ConfirmLinkRecord | typeof NOT_FOUND | typeof GONE> {
  if (!deps.secret) return NOT_FOUND;
  const verified = verifyConfirmLinkToken(token, deps.secret, now);
  if (!verified.ok) return verified.reason === 'expired' ? GONE : NOT_FOUND;
  const record = await deps.store.get(verified.linkId);
  return record ?? GONE;
}

/**
 * The linked question if it is still the one waiting for an answer, else
 * null. Links issued before `questionDigest` existed never match.
 *
 * @param record - The link / リンク記録
 * @param deps - Collaborators / 依存
 * @returns The pending question, or null / 待機中の質問、それ以外は null
 * @throws When the task or question.md cannot be read / 読み取りに失敗した場合
 */
export async function isStillPending(
  record: ConfirmLinkRecord,
  deps: Pick<ConfirmLinkServiceDeps, 'readTaskSnapshot' | 'readQuestion'>,
): Promise<ParsedQuestion | null> {
  const snapshot = await deps.readTaskSnapshot(record.taskId);
  if (snapshot?.workflowStatus !== 'awaiting_question') return null;
  if (snapshot.latestPauseId !== record.pauseTransitionId) return null;
  const content = await deps.readQuestion(record.taskId);
  if (content === null || !record.questionDigest) return null;
  if (computeQuestionDigest(content) !== record.questionDigest) return null;
  const linkable = resolveLinkableQuestion(content);
  return linkable.ok && linkable.question.id === record.questionId ? linkable.question : null;
}

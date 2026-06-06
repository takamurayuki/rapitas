/**
 * concern-bridge
 *
 * Orchestrates the bridge between the concern backlog (KnowledgeEntry-backed)
 * and GitHub issues: publishing a concern as an issue, importing an issue as a
 * concern, and pushing a local dismissal out as an issue close.
 * Not responsible for reading/sync of issues (see sync-webhook) — it only links.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createIssue, closeIssue } from './issue-operations';
import {
  getConcern,
  submitConcern,
  normalizeConcernType,
  normalizeConcernSeverity,
  type LinkedIssueRef,
} from '../memory/concern-backlog-service';

const log = createLogger('github:concern-bridge');

/** Result of a bridge mutation; `status` is the HTTP status the route should use. */
type BridgeResult<T> = ({ success: true } & T) | { success: false; status: number; error: string };

/**
 * Extracts a `<prefix>:<value>` label from a JSON labels string.
 * Used to recover the concern type/severity encoded into issue labels.
 */
function labelValue(labelsJson: string, prefix: string): string | undefined {
  try {
    const labels = JSON.parse(labelsJson || '[]') as string[];
    const hit = labels.find((l) => l.startsWith(`${prefix}:`));
    return hit?.slice(prefix.length + 1);
  } catch {
    return undefined;
  }
}

/**
 * Publishes a concern to GitHub as a new issue and links the two.
 * Idempotent: a concern that already has a linked issue is returned as-is.
 *
 * @param concernId - Concern to publish / 公開する懸念ID
 * @param integrationId - Target repository integration / 公開先リポジトリ
 * @param extraLabels - Optional extra labels / 追加ラベル
 * @returns The linked issue ref / リンクされたIssue
 */
export async function publishConcernToIssue(
  concernId: number,
  integrationId: number,
  extraLabels?: string[],
): Promise<BridgeResult<{ issue: LinkedIssueRef }>> {
  const concern = await getConcern(concernId);
  if (!concern) return { success: false, status: 404, error: '懸念が見つかりません' };
  if (concern.linkedIssue) {
    return { success: true, issue: concern.linkedIssue };
  }

  const integration = await prisma.gitHubIntegration.findUnique({ where: { id: integrationId } });
  if (!integration) return { success: false, status: 404, error: 'リポジトリ連携が見つかりません' };

  const repo = `${integration.ownerName}/${integration.repositoryName}`;
  const labels = [`type:${concern.type}`, `priority:${concern.severity}`, ...(extraLabels ?? [])];
  let body = concern.detail;
  if (concern.location) body += `\n\n対象箇所: ${concern.location}`;
  body += `\n\n— rapitas 懸念バックログ #${concern.id} から公開`;

  let issue;
  try {
    issue = await createIssue(repo, { title: concern.title, body, labels });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ concernId, repo, message }, 'Failed to create GitHub issue from concern');
    return { success: false, status: 502, error: `GitHub Issue の作成に失敗しました: ${message}` };
  }

  const saved = await prisma.gitHubIssue.upsert({
    where: { integrationId_issueNumber: { integrationId, issueNumber: issue.number } },
    update: {
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: JSON.stringify(issue.labels),
      authorLogin: issue.authorLogin,
      url: issue.url,
      linkedConcernId: concernId,
      lastSyncedAt: new Date(),
    },
    create: {
      integrationId,
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: JSON.stringify(issue.labels),
      authorLogin: issue.authorLogin,
      url: issue.url,
      linkedConcernId: concernId,
      lastSyncedAt: new Date(),
    },
  });

  log.info({ concernId, issueNumber: saved.issueNumber }, 'Concern published to GitHub issue');
  return {
    success: true,
    issue: { id: saved.id, issueNumber: saved.issueNumber, url: saved.url, state: saved.state },
  };
}

/**
 * Imports a synced GitHub issue into the concern backlog and links the two.
 * Idempotent: an already-linked issue returns its existing concern id.
 *
 * @param issueId - GitHubIssue row id / GitHubIssue の行ID
 * @returns The linked concern id / リンクされた懸念ID
 */
export async function importIssueAsConcern(
  issueId: number,
): Promise<BridgeResult<{ concernId: number }>> {
  const issue = await prisma.gitHubIssue.findUnique({ where: { id: issueId } });
  if (!issue) return { success: false, status: 404, error: 'Issue が見つかりません' };
  if (issue.linkedConcernId) {
    return { success: true, concernId: issue.linkedConcernId };
  }

  const concernId = await submitConcern({
    title: issue.title,
    detail: issue.body?.trim() || `(GitHub Issue #${issue.issueNumber})`,
    // Recover type/severity from labels if the issue was a published concern,
    // otherwise default to a generic concern.
    type: normalizeConcernType(labelValue(issue.labels, 'type') ?? 'other'),
    severity: normalizeConcernSeverity(labelValue(issue.labels, 'priority')),
    source: 'github_issue',
    // Stable per-issue key so re-importing the same issue never duplicates.
    dedupKey: `gh-issue:${issue.id}`,
  });

  await prisma.gitHubIssue.update({ where: { id: issueId }, data: { linkedConcernId: concernId } });
  log.info({ issueId, concernId }, 'GitHub issue imported as concern');
  return { success: true, concernId };
}

/**
 * Closes the GitHub issue linked to a concern (used when the concern is
 * dismissed locally). No-op when there is no open linked issue.
 *
 * @param concernId - Dismissed concern id / 却下された懸念ID
 */
export async function closeIssueForConcern(concernId: number): Promise<void> {
  const link = await prisma.gitHubIssue.findFirst({
    where: { linkedConcernId: concernId, state: 'open' },
    include: { integration: true },
  });
  if (!link) return;
  const repo = `${link.integration.ownerName}/${link.integration.repositoryName}`;
  try {
    await closeIssue(repo, link.issueNumber);
    await prisma.gitHubIssue.update({ where: { id: link.id }, data: { state: 'closed' } });
    log.info(
      { concernId, issueNumber: link.issueNumber },
      'Closed GitHub issue for dismissed concern',
    );
  } catch (err) {
    // Best-effort: a failed remote close must not block the local dismissal.
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ concernId, message }, 'Failed to close linked GitHub issue');
  }
}

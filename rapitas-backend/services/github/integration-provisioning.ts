/**
 * GitHub Integration Provisioning
 *
 * Decides which configured integration owns a repository, and builds the row to
 * create when none does yet.
 * Not responsible for the database call itself — callers own persistence, so
 * both decisions stay pure and testable.
 */

import type { OwnerRepo } from './owner-repo';

/** The subset of an integration row these decisions need. */
export interface IntegrationLike {
  id: number;
  ownerName: string;
  repositoryName: string;
}

/**
 * The integration that owns `ident`, or null when none does.
 *
 * NOTE: The single-integration fallback applies ONLY when the repository is
 * unknown (`ident` null). It used to apply unconditionally, which meant a
 * generated project's PR was filed under whatever integration happened to be
 * the only one — and `@@unique([integrationId, prNumber])` would then collide
 * PR #1 of one project with PR #1 of another. A known repository with no
 * integration must return null so the caller can provision the right one.
 *
 * @param integrations - Configured integrations / 登録済みの連携
 * @param ident - Repository identity, or null when it could not be resolved / リポジトリ識別子
 * @returns The owning integration id, or null / 該当する連携ID、無ければ null
 */
export function pickIntegrationId(
  integrations: readonly IntegrationLike[],
  ident: OwnerRepo | null | undefined,
): number | null {
  if (integrations.length === 0) return null;

  if (ident) {
    const owner = ident.owner.toLowerCase();
    const repo = ident.repo.toLowerCase();
    const match = integrations.find(
      (i) => i.ownerName.toLowerCase() === owner && i.repositoryName.toLowerCase() === repo,
    );
    return match ? match.id : null;
  }

  // Repository unknown: a single configured integration is still unambiguous.
  return integrations.length === 1 ? integrations[0].id : null;
}

/** The fields needed to create an integration for a repository. */
export interface IntegrationCreateData {
  repositoryUrl: string;
  ownerName: string;
  repositoryName: string;
}

/**
 * The row to create for a repository that has no integration yet.
 *
 * NOTE: `repositoryUrl` must match the stored convention
 * (`https://github.com/<owner>/<repo>`) because that column is `@unique` and is
 * the upsert key. Credentials are deliberately absent: `accessTokenEnc` is
 * nullable and the point of this row is visibility (so PR syncing and
 * auto-merge can see the project), not authenticated access — the agent's own
 * `gh` CLI session performs the GitHub operations.
 *
 * @param ident - Repository identity / リポジトリ識別子
 * @returns Fields for the new integration / 新規連携のフィールド
 */
export function integrationCreateData(ident: OwnerRepo): IntegrationCreateData {
  const owner = ident.owner.toLowerCase();
  const repo = ident.repo.toLowerCase();
  return {
    repositoryUrl: `https://github.com/${owner}/${repo}`,
    ownerName: owner,
    repositoryName: repo,
  };
}

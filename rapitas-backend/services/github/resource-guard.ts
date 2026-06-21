/**
 * GitHub Resource Guard
 *
 * Provides typed resolver functions that fetch a GitHub resource by ID and
 * throw NotFoundError (→ HTTP 404) when it does not exist.  Acts as the
 * standard precondition layer for GitHub route handlers.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError, parseId } from '../../middleware/error-handler';

/**
 * A GitHubPullRequest row with its parent integration included.
 * Derived from the Prisma payload so the type always stays in sync with the schema.
 */
export type ResolvedPr = Prisma.GitHubPullRequestGetPayload<{
  include: { integration: true };
}>;

/**
 * A GitHubIssue row with its parent integration included.
 */
export type ResolvedIssue = Prisma.GitHubIssueGetPayload<{
  include: { integration: true };
}>;

/**
 * A bare GitHubIntegration row (no nested relations needed for guard use-cases).
 */
export type ResolvedIntegration = Prisma.GitHubIntegrationGetPayload<Record<string, never>>;

/**
 * Generic guard: calls `fetch()` and throws NotFoundError when the result is
 * null or undefined.  All named wrappers below delegate to this function.
 *
 * @param fetch - Async thunk that returns the resource or null/undefined. / リソースを返すサンクまたはnull
 * @param message - Human-readable not-found message. / 見つからない場合のメッセージ
 * @param code - Machine-readable error code included in the JSON response. / JSONレスポンスのエラーコード
 * @returns The resolved resource. / 解決されたリソース
 * @throws {NotFoundError} When the resource does not exist. / リソースが存在しない場合
 */
export async function resolveOrThrow<T>(
  fetch: () => Promise<T | null | undefined>,
  message: string,
  code?: string,
): Promise<T> {
  const record = await fetch();
  if (record == null) {
    throw new NotFoundError(message, code);
  }
  return record;
}

/**
 * Resolve a GitHubPullRequest by its local DB id, including the parent integration.
 * Validates the id string before querying.
 *
 * @param id - Route param string to parse as the PR's local DB id. / ルートパラメータとして受け取ったID文字列
 * @returns The PR with its integration. / integrationを含むPRレコード
 * @throws {ValidationError} When `id` is not a positive integer. / idが正整数でない場合
 * @throws {NotFoundError} When no PR exists for that id. / PRが見つからない場合
 */
export async function resolvePrOrThrow(id: string): Promise<ResolvedPr> {
  const numericId = parseId(id, 'PR ID');
  return resolveOrThrow(
    () =>
      prisma.gitHubPullRequest.findUnique({
        where: { id: numericId },
        include: { integration: true },
      }),
    'PR not found',
    'PR_NOT_FOUND',
  );
}

/**
 * Resolve a GitHubIssue by its local DB id, including the parent integration.
 *
 * @param id - Route param string to parse as the Issue's local DB id. / ルートパラメータとして受け取ったID文字列
 * @returns The Issue with its integration. / integrationを含むIssueレコード
 * @throws {ValidationError} When `id` is not a positive integer. / idが正整数でない場合
 * @throws {NotFoundError} When no Issue exists for that id. / Issueが見つからない場合
 */
export async function resolveIssueOrThrow(id: string): Promise<ResolvedIssue> {
  const numericId = parseId(id, 'Issue ID');
  return resolveOrThrow(
    () =>
      prisma.gitHubIssue.findUnique({
        where: { id: numericId },
        include: { integration: true },
      }),
    'Issue not found',
    'ISSUE_NOT_FOUND',
  );
}

/**
 * Resolve a GitHubIntegration by its id.
 *
 * @param id - Route param string to parse as the Integration's local DB id. / ルートパラメータとして受け取ったID文字列
 * @returns The Integration record. / Integrationレコード
 * @throws {ValidationError} When `id` is not a positive integer. / idが正整数でない場合
 * @throws {NotFoundError} When no Integration exists for that id. / Integrationが見つからない場合
 */
export async function resolveIntegrationOrThrow(id: string | number): Promise<ResolvedIntegration> {
  const numericId = typeof id === 'number' ? id : parseId(id, 'Integration ID');
  return resolveOrThrow(
    () =>
      prisma.gitHubIntegration.findUnique({
        where: { id: numericId },
      }),
    'Integration not found',
    'INTEGRATION_NOT_FOUND',
  );
}

/**
 * IdeaBoxSearch
 *
 * Builds the free-text search fragment of the idea-box where clause
 * (title OR content contains, case-insensitive where the provider supports
 * it). Kept out of idea-box-service.ts so the search feature does not grow
 * that already-oversized module. Not responsible for the other filters.
 */
import { getInsensitiveMode } from '../../config/db-provider';

/**
 * Where-clause fragment for a free-text idea search.
 *
 * The match is wrapped in AND so it composes with the priority filter's own
 * OR (which encodes the implicit "medium" priority) instead of replacing it.
 *
 * @param search - Raw query string from the request / 検索文字列
 * @returns Prisma where fragment, or an empty object when blank / where断片
 */
export function buildIdeaSearchFilter(search: string | undefined): {
  AND?: Array<{
    OR: Array<Record<'title' | 'content', { contains: string; mode?: 'insensitive' }>>;
  }>;
} {
  const term = search?.trim();
  if (!term) return {};
  const contains = { contains: term, ...getInsensitiveMode() };
  return { AND: [{ OR: [{ title: contains }, { content: contains }] }] };
}

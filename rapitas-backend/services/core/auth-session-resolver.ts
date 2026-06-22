/**
 * Auth Session Resolver
 *
 * Provides the single authoritative query for resolving a UserSession by token.
 * Mirrors the structure of pr-task-resolver.ts so both PR and auth domains use
 * the same "domain-specific resolver" pattern.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

/** The full session row with its associated user, as used by all auth routes. */
export type ResolvedSession = Prisma.UserSessionGetPayload<{ include: { user: true } }>;

/**
 * Resolve a session by its token, returning the session row with the associated
 * user. Returns `null` when the token does not exist, is expired, or the DB
 * query fails — callers should treat `null` as 401.
 *
 * @param token - The `sessionToken` cookie value. / セッショントークン
 * @returns Session with user, or null. / セッションとユーザー行、無ければnull
 */
export async function resolveSessionByToken(token: string): Promise<ResolvedSession | null> {
  return prisma.userSession
    .findFirst({
      where: { sessionToken: token, expiresAt: { gt: new Date() } },
      include: { user: true },
    })
    .catch(() => null);
}

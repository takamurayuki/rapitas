/**
 * Auth Session Resolver
 *
 * Single source of truth for resolving a session token to a validated
 * UserSession row (with its associated user). Not responsible for HTTP
 * handling, auth-rate-limiting, or session creation/deletion.
 */
import type { Prisma } from '../../generated/prisma-postgres';
import { prisma } from '../../config/database';

/** Full UserSession row joined with its User — the payload callers need. / セッション行とユーザーを結合したペイロード */
export type SessionWithUser = Prisma.UserSessionGetPayload<{ include: { user: true } }>;

/**
 * Resolve a raw session token to its active UserSession (joined with User).
 * Returns null when the token is absent, expired, or a DB error occurs.
 *
 * @param token - Raw session token value from the cookie. / クッキーから取得したセッショントークン
 * @returns The active session with user, or null. / 有効なセッションとユーザー、無ければnull
 */
export async function resolveSessionByToken(token: string): Promise<SessionWithUser | null> {
  return prisma.userSession
    .findFirst({
      where: { sessionToken: token, expiresAt: { gt: new Date() } },
      include: { user: true },
    })
    .catch(() => null);
}

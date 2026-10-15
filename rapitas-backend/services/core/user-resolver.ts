/**
 * User Resolver
 *
 * Single source of truth for resolving User lookups by email or username.
 * Not responsible for HTTP handling, authentication, or user mutations.
 */
import type { Prisma } from '../../generated/prisma-postgres';
import { prisma } from '../../config/database';

/** Full User row — returned by all resolver functions in this module. */
export type ResolvedUser = Prisma.UserGetPayload<Record<string, never>>;

/**
 * Find a User by email address.
 * Returns null when the user is absent or a DB error occurs.
 *
 * @param email - Email address to look up. / 検索するメールアドレス
 * @returns Matching user row, or null. / 一致するユーザー行、なければnull
 */
export async function resolveUserByEmail(email: string): Promise<ResolvedUser | null> {
  return prisma.user.findFirst({ where: { email } }).catch(() => null);
}

/**
 * Find a User by username OR email (first match wins).
 * Used for login where either credential may be supplied.
 * Returns null when no match is found or a DB error occurs.
 *
 * @param username - Username to match. / 照合するユーザー名
 * @param email - Email to match as fallback. / フォールバックとして照合するメールアドレス
 * @returns Matching user row, or null. / 一致するユーザー行、なければnull
 */
export async function resolveUserByUsernameOrEmail(
  username: string,
  email: string,
): Promise<ResolvedUser | null> {
  return prisma.user.findFirst({ where: { OR: [{ username }, { email }] } }).catch(() => null);
}

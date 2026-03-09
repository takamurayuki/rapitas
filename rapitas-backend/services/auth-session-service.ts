/**
 * Auth Session Service
 * セッションの検証・リフレッシュ・期限切れクリーンアップ
 */
import { prisma } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('auth-session-service');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

/**
 * セッショントークンを検証する
 */
export async function validateSession(token: string) {
  // @ts-expect-error Session model not yet defined in Prisma schema
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!session) {
    log.warn({ token: token.slice(0, 8) }, 'Session not found');
    return null;
  }

  if (session.expiresAt < new Date()) {
    log.info({ sessionId: session.id }, 'Session expired');
    // @ts-expect-error Session model not yet defined in Prisma schema
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  return { session, user: session.user };
}

/**
 * セッションの有効期限を延長する
 */
export async function refreshSession(token: string) {
  const result = await validateSession(token);
  if (!result) return null;

  const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
  // @ts-expect-error Session model not yet defined in Prisma schema
  const updated = await prisma.session.update({
    where: { id: result.session.id },
    data: { expiresAt: newExpiry },
  });

  log.info({ sessionId: updated.id }, 'Session refreshed');
  return { session: updated, user: result.user };
}

/**
 * 期限切れセッションを一括削除する
 */
export async function cleanupExpiredSessions(): Promise<number> {
  // @ts-expect-error Session model not yet defined in Prisma schema
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  if (result.count > 0) {
    log.info({ count: result.count }, 'Expired sessions cleaned up');
  }
  return result.count;
}

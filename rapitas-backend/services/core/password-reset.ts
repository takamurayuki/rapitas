/**
 * PasswordReset
 *
 * Sets a new password for an existing account, from the machine the install
 * runs on.
 *
 * There is no "forgot password" flow in this app and no mail to send one
 * through; until tenancy landed there was no need, because the backend served
 * every row to a guest. Now the session decides whose data a request sees, so
 * an owner who has lost their password has lost their own data with it. This
 * is the way back: an operator action, run locally by whoever owns the
 * database — see scripts/reset-password.ts.
 *
 * NOT responsible for authenticating the caller. It is deliberately not an
 * HTTP route: this server answers unauthenticated requests by design
 * (workspace-request-wrapper's fail-open note), so an endpoint that rewrote
 * credentials would hand anyone who can reach the port a permanent account
 * takeover. Reaching the database is the authorization — which is why the
 * caller must SUPPLY the database rather than inherit a default one. It also
 * keeps this module from importing the shared Prisma client, whose provider
 * follows the ambient environment and is not the database an operator means.
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

/** The floor registration enforces; a reset must not undercut it. */
export const MIN_PASSWORD_LENGTH = 8;

/** Matches the cost factor used when registering, so hashes stay comparable. */
const BCRYPT_ROUNDS = 12;

/** Just the slice of the client this needs, so tests can supply their own. */
export interface PasswordResetDb {
  user: {
    findFirst: (args: {
      where: { OR: ({ username: string } | { email: string })[] };
      select: { id: true; username: true };
    }) => Promise<{ id: number; username: string } | null>;
    update: (args: { where: { id: number }; data: { passwordHash: string } }) => Promise<unknown>;
  };
  userSession: {
    deleteMany: (args: { where: { userId: number } }) => Promise<{ count: number }>;
  };
}

/** What a reset did. */
export interface PasswordResetResult {
  userId: number;
  username: string;
  /** Sessions that were ended, which is what makes the old password useless. */
  revokedSessions: number;
}

/**
 * A password that is safe to read off a terminal and type into a form.
 *
 * base64url, so there is nothing a shell or a copy-paste would mangle.
 *
 * @param bytes - Entropy to draw / 生成するバイト数
 * @returns The generated password / 生成されたパスワード
 */
export function generatePassword(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Give an existing account a new password and end its current sessions.
 *
 * Validation happens before any query, so a refusal leaves the database
 * untouched. The password is written only as a bcrypt hash.
 *
 * @param opts.identifier - Username or email of the account / 対象のユーザー名またはメール
 * @param opts.password - The new password, plaintext / 新しいパスワード（平文）
 * @param opts.db - The database to act on / 操作対象のデータベース
 * @param opts.hash - Hash function, injectable for tests / ハッシュ関数
 * @returns Who was changed, and how many sessions ended / 変更対象と失効セッション数
 * @throws {Error} When the identifier is blank, the password is too short, or no such account / 識別子が空、パスワードが短い、該当アカウントが無い場合
 */
export async function resetUserPassword(opts: {
  identifier: string;
  password: string;
  db: PasswordResetDb;
  hash?: (password: string) => Promise<string>;
}): Promise<PasswordResetResult> {
  const identifier = opts.identifier.trim();
  if (identifier === '') {
    throw new Error('[password-reset] give a username or email to reset');
  }
  if (opts.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `[password-reset] the new password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  const { db } = opts;
  const hash = opts.hash ?? ((password: string) => bcrypt.hash(password, BCRYPT_ROUNDS));

  const user = await db.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
    select: { id: true, username: true },
  });
  if (user === null) {
    throw new Error(`[password-reset] no account matches ${identifier}`);
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(opts.password) },
  });

  // After the write, not before: revoking first would leave a window in which
  // the OLD password still works and could mint a fresh session that survives
  // the reset.
  const { count } = await db.userSession.deleteMany({ where: { userId: user.id } });

  return { userId: user.id, username: user.username, revokedSessions: count };
}

/**
 * user-database-url
 *
 * Validation and masking for the connection string of a user's own database
 * (#1285). Only PostgreSQL is accepted: the app's schema is relational across
 * ~100 tables, and Firestore-style stores are out of scope (see the issue).
 * Pure — no I/O.
 */

/**
 * Check a user-supplied connection string.
 *
 * @param raw - What the user typed / 入力された接続文字列
 * @returns The trimmed URL, or an error saying what is wrong (never echoing the secret) / 検証結果
 */
export function validateDatabaseUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const url = (raw ?? '').trim();
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return { ok: false, error: 'Only postgresql:// connection strings are supported' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Not a valid postgresql:// URL (check the host)' };
  }
  if (!parsed.hostname) return { ok: false, error: 'The URL has no host' };
  if (!parsed.pathname || parsed.pathname === '/') {
    return { ok: false, error: 'The URL names no database (…/<database>)' };
  }
  return { ok: true, url };
}

/**
 * The URL with its password replaced, for display and logs.
 *
 * @param url - Connection string / 接続文字列
 * @returns Masked form; a string that cannot be parsed is masked entirely / マスク済み文字列
 */
export function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.password) return parsed.toString();
    // NOTE: Assembled from the parts rather than by string-replacing an encoded
    // placeholder: that replace hit the first match anywhere in the URL — the
    // username, if it happened to spell it — instead of the password slot.
    const host = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${parsed.protocol}//${parsed.username}:***@${host}`;
  } catch {
    return '***';
  }
}

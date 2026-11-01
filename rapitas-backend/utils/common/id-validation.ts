/**
 * IdValidation
 *
 * Decides whether a path segment is a usable database row id.
 * Not responsible for what to throw — callers raise their own error type, so
 * this stays free of any dependency (utils must not import middleware; see
 * COMPONENT_SPLITTING_POLICY §5 on circular imports).
 *
 * Why this exists (#1335 review): every id-taking route reached a row via
 * `parseInt(params.id)` guarded only by `isNaN`, and `parseInt` stops at the
 * first character it cannot read. So these all addressed row 5:
 *
 *   /tasks/5abc      -> 5
 *   /tasks/5e2       -> 5
 *   /tasks/5.9       -> 5
 *   /tasks/'5 OR 1=1'-> 5
 *
 * while `/tasks/0x10` became 0, `/tasks/-3` became -3, and
 * `/tasks/99999999999999999999` became 1e20 — past Number.MAX_SAFE_INTEGER,
 * where integer arithmetic silently stops being exact. On a PATCH or DELETE
 * that means a request which looks like it names one resource quietly
 * modifies another.
 */

/**
 * Digits only, at least one, nothing else — no sign, no decimal point, no
 * exponent, no surrounding whitespace.
 */
const STRICT_ID_PATTERN = /^\d+$/;

/**
 * Whether `raw` is a safe, positive, whole-number row id.
 *
 * Rejects anything `parseInt` would silently truncate, and anything beyond
 * `Number.MAX_SAFE_INTEGER`, where two different ids can compare equal.
 *
 * @param raw - The path segment as received / 受け取ったパス要素
 * @returns true when it is usable as an id / id として使えるか
 */
export function isValidEntityId(raw: string | undefined | null): boolean {
  if (typeof raw !== 'string' || !STRICT_ID_PATTERN.test(raw)) return false;
  const value = Number(raw);
  // 0 is not a row id in this schema (Prisma autoincrement starts at 1), and
  // allowing it invites a falsy-id bug in any caller that checks `if (id)`.
  return Number.isSafeInteger(value) && value > 0;
}

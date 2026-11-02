/**
 * auth-session
 *
 * Decides whether a page load should ask the backend who the viewer is.
 * Not responsible for performing that validation, nor for storing the hint.
 */

/**
 * Query marker the backend appends when handing the browser back from Google.
 *
 * Emitted by the callback redirect in
 * `routes/system/auth/google-oauth.ts` (`${frontendUrl()}/?auth_success=true`).
 * Renaming it on either side silently restores the bug below, so the two
 * spellings have to move together.
 */
const GOOGLE_RETURN_MARKER = 'auth_success';

/**
 * Whether this load must validate a session with the backend.
 *
 * The localStorage hint is per-ORIGIN, and the OAuth callback returns the
 * browser to FRONTEND_URL. Whenever the button was clicked on a different
 * host — `localhost:3000` vs `127.0.0.1:3000`, and the dev server answers
 * both — the hint written before leaving for Google is invisible on return.
 * Keying the probe on the hint alone therefore reported a freshly signed-in
 * user as a guest, with a valid session cookie sitting unread (2026-10-29).
 * The redirect's own marker is what makes the return path self-sufficient.
 *
 * @param params.hasHint - A session was established on THIS origin before / この origin で以前セッションを張ったか
 * @param params.search - `window.location.search`, with or without the leading `?` / クエリ文字列
 * @returns True when the session must be validated / 検証すべきなら true
 */
export function shouldValidateSession(params: { hasHint: boolean; search: string }): boolean {
  if (params.hasHint) return true;
  try {
    return new URLSearchParams(params.search).get(GOOGLE_RETURN_MARKER) === 'true';
  } catch {
    // A malformed query string is not evidence of a sign-in, and most loads
    // that carry one have nothing to do with auth — stay quiet.
    return false;
  }
}

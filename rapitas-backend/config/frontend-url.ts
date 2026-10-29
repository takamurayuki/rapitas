/**
 * FrontendUrl
 *
 * The one answer to "where is this install's frontend", for the redirects
 * that hand a browser back to it (Google sign-in, the calendar OAuth
 * callback). Not responsible for which origins may call this API — that is
 * CORS_ORIGIN.
 */

/**
 * Where the frontend is when nothing says otherwise.
 *
 * An IP literal, not `localhost`. The session cookie is set by this backend
 * on host 127.0.0.1 with SameSite=Strict, and SameSite compares host+scheme
 * while ignoring the port — so a page served from `localhost:3000` is
 * CROSS-site to `127.0.0.1:3001` and never sends the cookie. Redirecting
 * there straight after setting it returns the user from Google apparently
 * signed in and still a guest. The desktop app's `devUrl` is the IP literal
 * for the same reason, as is every client in this repo since the 2026-07
 * port-3001 takeover.
 */
export const DEFAULT_FRONTEND_URL = 'http://127.0.0.1:3000';

/**
 * The frontend's base URL, without a trailing slash.
 *
 * Callers append a path (`${frontendUrl()}/auth?error=…`), so a trailing
 * slash in the environment would produce a doubled one.
 *
 * @param env - Environment to read, injectable for tests / 読み取る環境変数
 * @returns The base URL / ベースURL
 */
export function frontendUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.FRONTEND_URL ?? '').trim();
  const base = configured === '' ? DEFAULT_FRONTEND_URL : configured;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

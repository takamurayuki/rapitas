/**
 * CorsOptions
 *
 * Resolves the allowed origins and builds the CORS options the app installs.
 * Not responsible for installing them — index.ts does that.
 *
 * Extracted from index.ts (#1336) so the policy can be asserted in tests. The
 * `exposeHeaders` entry in particular is invisible when wrong: a response
 * header that is not listed there simply cannot be read by the frontend, which
 * is a different origin (:3000 → :3001). The feature that depends on it then
 * does nothing, with no error anywhere.
 */

/** Response headers the cross-origin frontend is allowed to read. */
export const EXPOSED_RESPONSE_HEADERS = [
  // The cursor the next `GET /tasks` must use. The unpaginated full fetch
  // returns a bare array, so this is the only place the value can travel;
  // unexposed, the client silently falls back to its own clock and a machine
  // whose clock runs ahead skips every update in the gap (#1336).
  'X-Server-Cursor',
] as const;

/** Request headers the frontend may send. */
export const ALLOWED_REQUEST_HEADERS = [
  'Content-Type',
  'Authorization',
  'Cookie',
  // NOTE: X-Rapitas-Source lets the (cross-origin) frontend tag user-originated
  // requests for the UI-quiet restart gate; without it the preflight strips it.
  'X-Rapitas-Source',
] as const;

/** Origins trusted when CORS_ORIGIN is unset. */
export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'tauri://localhost',
] as const;

/**
 * Parse the allowed origins from the environment.
 *
 * @param rawEnv - The CORS_ORIGIN value, if any / CORS_ORIGIN の値
 * @returns The origin allowlist / 許可するオリジン
 * @throws {Error} When the list contains `*` or `null` / `*` か `null` が含まれる場合
 */
export function resolveCorsOrigins(rawEnv: string | undefined): string[] {
  const origins = rawEnv
    ? rawEnv
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [...DEFAULT_CORS_ORIGINS];

  // NOTE: credentials:true + wildcard origin would let ANY site read
  // authenticated responses (cookies/tokens attach cross-origin). A
  // misconfigured CORS_ORIGIN must fail at startup, not ship silently.
  if (origins.some((o) => o === '*' || o === 'null')) {
    throw new Error(
      'CORS_ORIGIN must not contain "*" or "null" while credentials are enabled — list explicit origins.',
    );
  }
  return origins;
}

/**
 * Build the options passed to the cors() plugin.
 *
 * @param rawEnv - The CORS_ORIGIN value, if any / CORS_ORIGIN の値
 * @returns Options for @elysiajs/cors / cors プラグインのオプション
 * @throws {Error} When the origin list is unsafe / オリジン指定が危険な場合
 */
export function buildCorsOptions(rawEnv: string | undefined) {
  return {
    origin: resolveCorsOrigins(rawEnv),
    credentials: true,
    allowedHeaders: [...ALLOWED_REQUEST_HEADERS],
    exposeHeaders: [...EXPOSED_RESPONSE_HEADERS],
    // NOTE: a mutable array, not `as const` — @elysiajs/cors types `methods`
    // as a mutable list and rejects a readonly tuple.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // NOTE: Preflight impact assessment for the X-Rapitas-Source rollout (task #570):
    // the apiClient path already sends Content-Type: application/json on every
    // request, so it was preflighted before the header existed — zero new OPTIONS
    // there. Net-new preflights come only from fetchWithRetry GETs that used to be
    // simple requests. @elysiajs/cors defaults maxAge to 5s, which would re-issue
    // OPTIONS roughly every 5s for polling GETs (~2x request volume); 7200s is
    // Chrome's preflight-cache cap and bounds that churn to once per 2h per route.
    maxAge: 7200,
  };
}

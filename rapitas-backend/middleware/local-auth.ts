/**
 * LocalAuth
 *
 * Network-exposure guard for the backend: resolves the listen host
 * (loopback by default) and provides a bearer-token gate for deliberate
 * non-loopback exposure. Not responsible for user-level authentication.
 */
import { timingSafeEqual } from 'crypto';
import { createLogger } from '../config/logger';

const log = createLogger('local-auth');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Resolve the host the server should bind to.
 *
 * Defaults to 127.0.0.1 — the backend has no user authentication, and its
 * agent-execution endpoints amount to arbitrary code execution, so it must
 * never be reachable from the LAN by default. A non-loopback bind
 * (RAPITAS_BIND_HOST) is honoured ONLY when RAPITAS_API_TOKEN is also set;
 * otherwise we fall back to loopback and log loudly rather than exposing an
 * unauthenticated API.
 *
 * @returns Host string to pass to app.listen / listen に渡すホスト
 */
export function resolveBindHost(): string {
  const requested = process.env.RAPITAS_BIND_HOST?.trim();
  if (!requested || LOOPBACK_HOSTS.has(requested)) {
    return '127.0.0.1';
  }
  if (!process.env.RAPITAS_API_TOKEN) {
    log.error(
      `RAPITAS_BIND_HOST=${requested} requested WITHOUT RAPITAS_API_TOKEN — ` +
        'refusing to expose the unauthenticated API beyond loopback. Binding to 127.0.0.1. ' +
        'Set RAPITAS_API_TOKEN to allow non-loopback binding.',
    );
    return '127.0.0.1';
  }
  log.warn(
    `Binding to ${requested} (non-loopback) — API token authentication is enforced for all requests.`,
  );
  return requested;
}

/**
 * Constant-time token comparison (length leak only).
 *
 * @param provided - Token from the request / リクエスト側トークン
 * @param expected - Configured token / 設定トークン
 * @returns true when equal / 一致すればtrue
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Build the request-level token guard, or null when no token is configured
 * (the default loopback-only deployment, where the OS already scopes access
 * to local processes).
 *
 * Accepts the token via `Authorization: Bearer <token>` or, for EventSource
 * clients that cannot set headers, a `?token=` query parameter. OPTIONS
 * requests pass through so CORS preflights (which carry no credentials) work.
 *
 * @returns onRequest handler or null / onRequestハンドラ（未設定ならnull）
 */
export function createApiTokenGuard():
  | ((ctx: { request: Request }) => Response | undefined)
  | null {
  const token = process.env.RAPITAS_API_TOKEN;
  if (!token) return null;

  log.info('API token guard enabled — all requests require RAPITAS_API_TOKEN');

  return ({ request }) => {
    if (request.method === 'OPTIONS') return undefined;

    const header = request.headers.get('authorization');
    if (header?.startsWith('Bearer ') && tokenMatches(header.slice(7), token)) {
      return undefined;
    }

    const url = new URL(request.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken && tokenMatches(queryToken, token)) {
      return undefined;
    }

    return new Response(JSON.stringify({ error: 'Unauthorized: missing or invalid API token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  };
}

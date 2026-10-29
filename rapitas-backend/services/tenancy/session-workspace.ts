/**
 * SessionWorkspace
 *
 * Turns a session cookie into the workspace its owner is working in. The one
 * input to workspace scoping that comes from the outside world.
 *
 * NOT responsible for creating workspaces (workspace-provisioning), deciding
 * what to do with the answer (workspace-scope), or authenticating the session
 * itself — that is auth-session-resolver, which this delegates to so there is
 * still one definition of "a valid session".
 */
import { prisma } from '../../config/database';
import { resolveSessionByToken } from '../core/auth-session-resolver';
import { runAcrossAllWorkspaces } from './workspace-context';

/**
 * How long a resolved token keeps its answer.
 *
 * Without this, every request costs two extra queries (session, membership)
 * before its own work starts. 30s is short enough that revoking a session or
 * moving a user between workspaces takes effect while someone is still
 * looking at the screen, and long enough that a page load with a dozen
 * parallel requests resolves once.
 */
const TTL_MS = 30_000;

interface CacheEntry {
  workspaceId: number | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Drop everything cached. Called after login/logout and by tests. */
export function clearSessionWorkspaceCache(): void {
  cache.clear();
}

/** Forget one token, so the next request re-reads it. */
export function forgetSessionWorkspace(token: string): void {
  cache.delete(token);
}

/**
 * The `sessionToken` value from a raw Cookie header, or null.
 *
 * Parsed by hand because Elysia's `onRequest` hook runs before the cookie
 * plugin has populated `context.cookie` — the hook only has the Request.
 *
 * @param header - Raw `Cookie` header value / Cookieヘッダの生の値
 * @returns The session token, or null when absent / セッショントークン、無ければnull
 */
export function readSessionToken(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== 'sessionToken') continue;
    const raw = part.slice(eq + 1).trim();
    if (raw === '') return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape is not a session; treat it as absent
      // rather than throwing inside a request hook.
      return raw;
    }
  }
  return null;
}

/**
 * Which workspace this session is working in.
 *
 * Returns null for an absent, expired or unknown session, and for a valid
 * session whose user belongs to no workspace — all of which mean "no
 * workspace", which workspace-scope passes through unchanged.
 *
 * @param token - Raw session token / 生のセッショントークン
 * @returns The workspace id, or null / ワークスペースID、無ければnull
 */
export async function resolveWorkspaceForSession(token: string): Promise<number | null> {
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expiresAt > now) return hit.workspaceId;

  // Unscoped on purpose: this runs to DECIDE the scope, and UserSession and
  // WorkspaceMember are not workspace-owned. Wrapping it also keeps a stale
  // context from an earlier enterWith on this branch out of the lookup.
  const workspaceId = await runAcrossAllWorkspaces(async () => {
    const session = await resolveSessionByToken(token);
    if (!session) return null;
    const membership = await prisma.workspaceMember
      .findFirst({
        where: { userId: session.userId },
        orderBy: { id: 'asc' },
        select: { workspaceId: true },
      })
      .catch(() => null);
    return membership?.workspaceId ?? null;
  });

  cache.set(token, { workspaceId, expiresAt: now + TTL_MS });
  return workspaceId;
}

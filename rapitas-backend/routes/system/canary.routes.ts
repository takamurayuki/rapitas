/**
 * Canary routes
 *
 * Public hit endpoint for URL-style canary tokens plus the admin API to issue
 * tokens and promote the deployment stage. Thin layer — logic lives in
 * services/security. The admin API is restricted to direct loopback callers
 * because the hit endpoint is the part meant to be reachable from outside.
 */
import { Elysia, t } from 'elysia';
import { createRateLimiter } from '../../middleware/rate-limiter';
import {
  CanaryLedgerError,
  issueToken,
  loadLedger,
  promoteToProduction,
} from '../../services/security/canary-ledger';
import { handleCanaryHit, type CanaryDeps } from '../../services/security/canary-service';

// Keyed by the raw socket address only; X-Forwarded-For is attacker-controlled
// and would let a caller rotate its way around the limit.
const hitRateLimit = createRateLimiter('canary', { maxRequests: 30, windowMs: 60_000 });

type RateSet = { status?: number | string; headers: Record<string, string> };

type RequestServer = { requestIP?: (req: Request) => { address: string } | null } | null;

/** Collaborators of the router; `resolveIp` exists so tests can supply a socket address. */
export interface CanaryRouteDeps extends CanaryDeps {
  resolveIp?: (request: Request, server: RequestServer | undefined) => string | null;
}

interface RouteContext {
  params: { tokenId: string };
  request: Request;
  set: unknown;
  server?: RequestServer;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Headers a reverse proxy or tunnel adds; their presence means the caller is not local. */
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'];

function defaultResolveIp(request: Request, server: RequestServer | undefined): string | null {
  return server?.requestIP?.(request)?.address ?? null;
}

/**
 * Admin calls are allowed only from a direct loopback socket with no proxy
 * headers: a tunnel that exposes the hit URL connects from loopback too, so the
 * forwarding headers are what tell a relayed request apart. Unknown fails closed.
 */
function isLocalAdmin(request: Request, ip: string | null): boolean {
  if (!ip || !LOOPBACK.has(ip)) return false;
  return FORWARDING_HEADERS.every((h) => !request.headers.get(h));
}

function badRequest(err: unknown, set: { status?: number | string }) {
  if (err instanceof CanaryLedgerError) {
    set.status = 400;
    return { error: err.message };
  }
  throw err;
}

/**
 * Build the canary router.
 *
 * @param deps - Optional collaborator overrides (tests inject a notifier and resolver) / 依存の差し替え
 * @returns Elysia router mounted at /canary / ルーター
 */
export function createCanaryRoutes(deps: CanaryRouteDeps = {}) {
  const resolveIp = deps.resolveIp ?? defaultResolveIp;

  const onHit = async (ctx: RouteContext) => {
    const { params, request, server } = ctx;
    const set = ctx.set as RateSet;
    const ip = resolveIp(request, server);
    if (!hitRateLimit(set, ip ?? undefined)) return '';

    await handleCanaryHit(
      {
        tokenId: params.tokenId,
        ip,
        forwardedFor: request.headers.get('x-forwarded-for'),
        ua: request.headers.get('user-agent'),
        now: new Date(),
      },
      deps,
    );
    // Same body and status for a matching and a non-matching id, so the endpoint
    // cannot be used as an oracle for valid tokens.
    set.status = 404;
    return '';
  };

  /** Returns true (and sets 403) when the caller may not use the admin API. */
  const denyAdmin = (ctx: { request: Request; set: unknown; server?: RequestServer }) => {
    if (isLocalAdmin(ctx.request, resolveIp(ctx.request, ctx.server))) return false;
    (ctx.set as { status?: number | string }).status = 403;
    return true;
  };

  return new Elysia({ prefix: '/canary' })
    .get('/hit/:tokenId', (ctx) => onHit(ctx as unknown as RouteContext))
    .post('/hit/:tokenId', (ctx) => onHit(ctx as unknown as RouteContext))

    .get('/tokens', (ctx) => {
      if (denyAdmin(ctx as unknown as RouteContext)) return { error: 'forbidden' };
      const ledger = loadLedger();
      return { stage: ledger.stage, promotion: ledger.promotion, tokens: ledger.tokens };
    })

    .post(
      '/tokens',
      (ctx) => {
        if (denyAdmin(ctx as unknown as RouteContext)) return { error: 'forbidden' };
        try {
          return issueToken(ctx.body);
        } catch (err) {
          return badRequest(err, ctx.set);
        }
      },
      {
        body: t.Object({
          label: t.String({ minLength: 1 }),
          placement: t.Union([t.Literal('isolated'), t.Literal('production')]),
          placementPath: t.Optional(t.String()),
          baseUrl: t.Optional(t.String()),
        }),
      },
    )

    .post(
      '/stage/promote',
      (ctx) => {
        if (denyAdmin(ctx as unknown as RouteContext)) return { error: 'forbidden' };
        try {
          const ledger = promoteToProduction(ctx.body.falsePositiveReview);
          return { stage: ledger.stage, promotion: ledger.promotion };
        } catch (err) {
          return badRequest(err, ctx.set);
        }
      },
      {
        body: t.Object({
          falsePositiveReview: t.Object({
            acknowledgedFalsePositiveReview: t.Literal(true),
            reviewer: t.String(),
            reviewedAt: t.String(),
            isolatedHitCount: t.Number(),
            falsePositiveCount: t.Number(),
          }),
        }),
      },
    );
}

export const canaryRoutes = createCanaryRoutes();

export default canaryRoutes;

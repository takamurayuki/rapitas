/**
 * Usage Budget Router
 *
 * Elysia sub-router (mounted under /agent-metrics) for the daily × theme usage
 * view, the advisory monthly budget, threshold evaluation, prompt responses and
 * classification rules. Thin layer: validation errors map to 400, everything
 * else is delegated. Never blocks or throttles an execution.
 */

import { Elysia } from 'elysia';
import { createLogger } from '../../../config/logger';
import {
  parseTzOffset,
  usageBudgetService,
  UsageBudgetValidationError,
  type ClassificationRule,
  type UsageBudgetService,
} from '../../../services/usage-budget';
import { getThemeUsage } from './queries/theme-usage';

const log = createLogger('routes:agent-metrics:usage-budget');

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

/** Collaborators of the router, injectable for tests. */
export interface UsageBudgetRouterDeps {
  service: Pick<
    UsageBudgetService,
    'getStatus' | 'evaluate' | 'updateBudget' | 'respondToPrompt' | 'getRules' | 'replaceRules'
  >;
  getThemeUsage: typeof getThemeUsage;
}

type Ctx = { set: { status?: number | string } };

function badRequest(set: Ctx['set'], error: string) {
  set.status = 400;
  return { success: false, error };
}

/** Run a handler, mapping validation errors to 400 and anything else to 500. */
async function handle<T>(set: Ctx['set'], what: string, fn: () => Promise<T>) {
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    if (error instanceof UsageBudgetValidationError) return badRequest(set, error.message);
    log.error({ err: error }, `Error: ${what}`);
    set.status = 500;
    return { success: false, error: `Failed to ${what}` };
  }
}

function parseDays(raw: unknown): number | null {
  if (raw === undefined || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_DAYS ? n : null;
}

/**
 * Build the router over the given collaborators.
 *
 * @param deps - Service and theme-usage query / サービスと集計クエリ
 * @returns Elysia router / ルーター
 */
export function createUsageBudgetRouter(deps: UsageBudgetRouterDeps) {
  return new Elysia()
    .get('/theme-usage', async ({ query, set }) => {
      const days = parseDays(query.days);
      const tz = parseTzOffset(query.tzOffsetMinutes);
      if (days === null) return badRequest(set, `days must be an integer 1-${MAX_DAYS}`);
      if (tz === null) return badRequest(set, 'tzOffsetMinutes must be an integer -840..840');
      return handle(set, 'aggregate theme usage', async () =>
        deps.getThemeUsage({ days, tzOffsetMinutes: tz, rules: await deps.service.getRules() }),
      );
    })
    .get('/usage-budget/status', async ({ query, set }) => {
      const tz = parseTzOffset(query.tzOffsetMinutes);
      if (tz === null) return badRequest(set, 'tzOffsetMinutes must be an integer -840..840');
      return handle(set, 'read usage budget status', () => deps.service.getStatus(tz));
    })
    .post('/usage-budget/evaluate', async ({ query, set }) => {
      const tz = parseTzOffset(query.tzOffsetMinutes);
      if (tz === null) return badRequest(set, 'tzOffsetMinutes must be an integer -840..840');
      return handle(set, 'evaluate usage budget', () => deps.service.evaluate(tz));
    })
    .put('/usage-budget', async ({ query, body, set }) => {
      const tz = parseTzOffset(query.tzOffsetMinutes);
      if (tz === null) return badRequest(set, 'tzOffsetMinutes must be an integer -840..840');
      const b = (body ?? {}) as { unit?: unknown; monthlyLimit?: unknown; shares?: unknown };
      return handle(set, 'save usage budget', () => deps.service.updateBudget(b, tz));
    })
    .post('/usage-budget/prompt-response', async ({ query, body, set }) => {
      const tz = parseTzOffset(query.tzOffsetMinutes);
      if (tz === null) return badRequest(set, 'tzOffsetMinutes must be an integer -840..840');
      const b = (body ?? {}) as { action?: unknown; monthlyLimit?: unknown };
      return handle(set, 'record usage budget prompt response', () =>
        deps.service.respondToPrompt(b, tz),
      );
    })
    .get('/usage-budget/rules', async ({ set }) =>
      handle<ClassificationRule[]>(set, 'read classification rules', () => deps.service.getRules()),
    )
    .put('/usage-budget/rules', async ({ body, set }) => {
      const rules = (body as { rules?: unknown } | null)?.rules;
      return handle(set, 'save classification rules', () => deps.service.replaceRules(rules));
    });
}

/** Router bound to the live service; mounted by router.ts. */
export const usageBudgetRouter = createUsageBudgetRouter({
  service: usageBudgetService,
  getThemeUsage,
});

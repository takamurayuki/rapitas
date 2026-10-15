/**
 * failure-lineage routes
 *
 * GET /agents/failure-lineage?hours=24 — read-only, on-demand estimate of the
 * failure lineage graph. Validates the window (400 on bad input, never a
 * silent default) and delegates everything else to the failure-lineage service.
 */
import { Elysia } from 'elysia';
import { createLogger } from '../../../config/logger';
import { computeFailureLineage } from '../../../services/failure-lineage';

const log = createLogger('routes:failure-lineage');

/** Default window when `hours` is omitted. */
export const DEFAULT_HOURS = 24;
/** Inclusive bounds for `hours` (7 days max). */
export const MIN_HOURS = 1;
export const MAX_HOURS = 168;

/**
 * Parses the `hours` query parameter.
 *
 * @param raw - Raw query value / クエリ値
 * @returns Hours, or null when present but invalid / 時間数、不正ならnull
 */
export function parseHours(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_HOURS;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= MIN_HOURS && n <= MAX_HOURS ? n : null;
}

export const failureLineageRoutes = new Elysia({ prefix: '/agents' }).get(
  '/failure-lineage',
  async ({ query, set }) => {
    const hours = parseHours((query as Record<string, unknown>).hours);
    if (hours === null) {
      set.status = 400;
      return {
        success: false,
        error: `Invalid hours: expected an integer between ${MIN_HOURS} and ${MAX_HOURS}`,
      };
    }
    try {
      const data = await computeFailureLineage(hours);
      return { success: true, ...data };
    } catch (err) {
      // No partial result: a half-computed lineage would read as fact.
      log.error({ err }, '[failure-lineage] failed to compute lineage');
      set.status = 500;
      return { success: false, error: 'Failed to compute failure lineage' };
    }
  },
);

export default failureLineageRoutes;

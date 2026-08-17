/**
 * Recovery Metrics Route
 *
 * Read-only aggregation of recovery attempt records (recovery-metrics JSONL)
 * into per-(errorType × strategy) success/latency/cost metrics for the UI.
 * Not responsible for recording attempts — see services/ai/recovery-metrics.
 */
import { Elysia, t } from 'elysia';
import {
  aggregate,
  getRecoveryMetricsMinSamples,
  getRecoveryMetricsWindowDays,
  readRecords,
} from '../../../services/ai/recovery-metrics';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bound for ?windowDays= so a typo can't force a full-history scan window. */
const MAX_WINDOW_DAYS = 365;

export const recoveryMetricsRoutes = new Elysia().get(
  '/agents/recovery-metrics',
  ({ query }) => {
    const requested = query.windowDays !== undefined ? Number(query.windowDays) : NaN;
    const windowDays =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_WINDOW_DAYS)
        : getRecoveryMetricsWindowDays();
    const nowMs = Date.now();
    const windowMs = windowDays * DAY_MS;
    const minSamples = getRecoveryMetricsMinSamples();
    const records = readRecords(nowMs - windowMs);
    return {
      metrics: aggregate(records, { windowMs, minSamples, nowMs }),
      windowDays,
      minSamples,
      generatedAtMs: nowMs,
    };
  },
  {
    query: t.Object({ windowDays: t.Optional(t.String()) }),
  },
);

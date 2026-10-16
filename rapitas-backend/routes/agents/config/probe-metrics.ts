/**
 * Probe Metrics Route
 *
 * Read-only aggregation of preflight probe attempt records (probe-metrics
 * JSONL) into per-target success/latency metrics for the UI. Not responsible
 * for recording attempts — see services/ai/probe-metrics.
 */
import { Elysia, t } from 'elysia';
import {
  aggregate,
  getProbeMetricsMinSamples,
  getProbeMetricsWindowDays,
  readRecords,
} from '../../../services/ai/probe-metrics';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bound for ?windowDays= so a typo can't force a full-history scan window. */
const MAX_WINDOW_DAYS = 365;

export const probeMetricsRoutes = new Elysia().get(
  '/agents/probe-metrics',
  ({ query }) => {
    const requested = query.windowDays !== undefined ? Number(query.windowDays) : NaN;
    const windowDays =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_WINDOW_DAYS)
        : getProbeMetricsWindowDays();
    const nowMs = Date.now();
    const windowMs = windowDays * DAY_MS;
    const minSamples = getProbeMetricsMinSamples();
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

/**
 * Decision Ledger Router
 *
 * Read-only view over every judgement the system makes that can later be shown
 * right or wrong, normalized across the three tables that store them. Reporting
 * only — nothing here writes, and no verdict is decided here.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../../config/logger';
import {
  readDecisions,
  summarizeBy,
  summarizeVerdicts,
  type DecisionKind,
} from '../../../services/decision-ledger';

const log = createLogger('routes:decision-ledger');

const KINDS: DecisionKind[] = [
  'model_tier',
  'workflow_mode',
  'risk_floor',
  'task_filing',
  'escalation',
  'plan_approval',
  'knowledge_use',
];

/** Default lookback when the caller does not narrow the window. */
const DEFAULT_DAYS = 14;

/** Recent decisions returned alongside the summary, newest first. */
const SAMPLE_SIZE = 50;

export const decisionLedgerRouter = new Elysia({ prefix: '/agents' }).get(
  '/decision-ledger',
  async (context) => {
    const { query } = context;
    const days = query.days ? parseInt(query.days, 10) : DEFAULT_DAYS;
    const taskId = query.taskId ? parseInt(query.taskId, 10) : undefined;
    const kinds = query.kinds
      ? query.kinds.split(',').filter((k): k is DecisionKind => KINDS.includes(k as DecisionKind))
      : undefined;

    if (!Number.isFinite(days) || days <= 0) {
      context.set.status = 400;
      return { success: false, error: 'days must be a positive number' };
    }

    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const decisions = await readDecisions({
        since,
        ...(taskId !== undefined && !Number.isNaN(taskId) ? { taskId } : {}),
        ...(kinds && kinds.length > 0 ? { kinds } : {}),
      });

      return {
        success: true,
        data: {
          windowDays: days,
          overall: summarizeVerdicts(decisions),
          byKind: Object.fromEntries(summarizeBy(decisions, (d) => d.kind)),
          bySubject: Object.fromEntries(summarizeBy(decisions, (d) => d.subject)),
          recent: decisions.slice(0, SAMPLE_SIZE),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, '[decision-ledger] read failed');
      context.set.status = 500;
      return { success: false, error: msg };
    }
  },
  {
    query: t.Object({
      days: t.Optional(t.String()),
      taskId: t.Optional(t.String()),
      kinds: t.Optional(t.String()),
    }),
  },
);

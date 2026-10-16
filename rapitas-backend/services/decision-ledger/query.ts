/**
 * decision-ledger/query
 *
 * The single read path over the three tables that store judgements. Callers ask
 * for decisions; which table a decision lives in is this module's problem, not
 * theirs.
 *
 * Read-only by construction — every write still happens where it happened
 * before, so there is no second source of truth to keep in sync.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { fromDecisionLog } from './from-decision-log';
import { fromDecisionTrace } from './from-decision-trace';
import { fromLearningRecord } from './from-learning-record';
import type { Decision, DecisionFilter, DecisionKind } from './types';

const log = createLogger('decision-ledger');

const DEFAULT_LIMIT = 500;

/** Kinds each source can produce, so a filtered read skips sources entirely. */
const KINDS_BY_SOURCE: Record<'trace' | 'record' | 'log', DecisionKind[]> = {
  trace: ['model_tier', 'risk_floor', 'escalation', 'knowledge_use'],
  record: ['workflow_mode'],
  log: ['plan_approval'],
};

/** True when the filter asks for at least one kind the source can supply. */
function wants(filter: DecisionFilter, source: 'trace' | 'record' | 'log'): boolean {
  if (!filter.kinds || filter.kinds.length === 0) return true;
  return filter.kinds.some((k) => KINDS_BY_SOURCE[source].includes(k));
}

/**
 * Read decisions across every source, newest first.
 *
 * A source that fails to read contributes nothing rather than failing the whole
 * call: a partial ledger is more useful than none, and the caller can see which
 * sources answered via each decision's `source`.
 *
 * @param filter - Narrowing to apply. / 絞り込み条件
 * @returns Decisions, newest first. / 決定（新しい順）
 */
export async function readDecisions(filter: DecisionFilter = {}): Promise<Decision[]> {
  const take = filter.limit ?? DEFAULT_LIMIT;
  const at = filter.since ? { gte: filter.since } : undefined;
  const taskId = filter.taskId;

  const [traces, records, logs] = await Promise.all([
    wants(filter, 'trace')
      ? prisma.agentDecisionTrace
          .findMany({
            where: {
              ...(taskId !== undefined ? { taskId } : {}),
              ...(at ? { createdAt: at } : {}),
            },
            orderBy: { id: 'desc' },
            take,
          })
          .catch((err: unknown) => {
            log.warn({ err }, '[decision-ledger] decision traces unreadable');
            return [];
          })
      : Promise.resolve([]),
    wants(filter, 'record')
      ? prisma.workflowLearningRecord
          .findMany({
            where: {
              ...(taskId !== undefined ? { taskId } : {}),
              ...(at ? { createdAt: at } : {}),
            },
            orderBy: { id: 'desc' },
            take,
          })
          .catch((err: unknown) => {
            log.warn({ err }, '[decision-ledger] learning records unreadable');
            return [];
          })
      : Promise.resolve([]),
    wants(filter, 'log')
      ? prisma.decisionLog
          .findMany({
            where: {
              ...(taskId !== undefined ? { taskId } : {}),
              ...(at ? { createdAt: at } : {}),
            },
            orderBy: { id: 'desc' },
            take,
          })
          .catch((err: unknown) => {
            log.warn({ err }, '[decision-ledger] decision logs unreadable');
            return [];
          })
      : Promise.resolve([]),
  ]);

  const merged: Decision[] = [
    ...traces.map(fromDecisionTrace),
    ...records.map(fromLearningRecord),
    ...logs.map(fromDecisionLog),
  ];

  const kinds = filter.kinds;
  const filtered = kinds?.length ? merged.filter((d) => kinds.includes(d.kind)) : merged;
  return filtered.sort((a, b) => b.at.getTime() - a.at.getTime());
}

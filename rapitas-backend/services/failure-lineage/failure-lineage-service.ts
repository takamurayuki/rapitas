/**
 * failure-lineage-service
 *
 * Orchestrates the read-only, on-demand lineage computation: loads recent
 * AgentExecutionLog rows and DecisionLog texts, then runs normalize -> edges ->
 * root-cause scoring -> validation. Nothing is persisted.
 */
import { prisma } from '../../config/database';
import type { LineageResult } from './failure-lineage-types';
import { buildClusters, buildEdges, buildNodes } from './lineage-builder';
import { validateLineage } from './postmortem-validator';
import { scoreRootCauses } from './root-cause-scorer';

/** Hard cap on scanned log rows. */
export const MAX_LOG_ROWS = 5000;

/** Result plus truncation flag. */
export interface FailureLineageResponse extends LineageResult {
  truncated: boolean;
  /** Always true: every parent/child relation is an inference. */
  isEstimated: true;
  windowHours: number;
}

/**
 * Computes the failure lineage for the trailing window.
 *
 * @param hours - Window length in hours (1-168) / 対象期間(時間)
 * @returns Lineage with estimates flagged / 系譜図
 * @throws Re-throws DB errors; no partial result is returned / DBエラーはそのまま送出
 */
export async function computeFailureLineage(hours: number): Promise<FailureLineageResponse> {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  // Newest first so truncation drops the oldest rows.
  const fetched = await prisma.agentExecutionLog.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: 'desc' },
    take: MAX_LOG_ROWS + 1,
    select: {
      id: true,
      executionId: true,
      logChunk: true,
      logType: true,
      sequenceNumber: true,
      timestamp: true,
    },
  });
  const truncated = fetched.length > MAX_LOG_ROWS;
  const rows = truncated ? fetched.slice(0, MAX_LOG_ROWS) : fetched;

  const decisions = await prisma.decisionLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { decision: true, context: true, rationale: true, actualOutcome: true },
  });
  const decisionTexts = decisions.map((d) =>
    [d.decision, d.context, d.rationale ?? '', d.actualOutcome ?? ''].join('\n'),
  );

  const nodes = buildNodes(rows);
  const edges = buildEdges(nodes);
  return {
    nodes,
    edges,
    clusters: buildClusters(nodes),
    rootCauseCandidates: scoreRootCauses(nodes, edges),
    validation: validateLineage(nodes, edges, decisionTexts),
    truncated,
    isEstimated: true,
    windowHours: hours,
  };
}

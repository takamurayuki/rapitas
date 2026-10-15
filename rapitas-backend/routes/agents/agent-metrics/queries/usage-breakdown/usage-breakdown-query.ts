/**
 * Agent Usage Breakdown Query
 *
 * Aggregates the per-execution metrics (costUsd, tokens, cache reads) by the
 * agent role that ran them — researcher / planner / implementer / verifier /
 * auto_verifier — using AgentSession.mode (`workflow-<role>`). Pure DB
 * aggregation of already-recorded real data; performs no LLM calls, so
 * rendering this breakdown adds zero API cost.
 */

import { prisma } from '../../../../../config/database';
import { toNumber, toInt } from '../../metric-coercion';
import { classifyCliAgent, CLI_AGENT_ORDER, type CliAgentKind } from '../../cli-agent-classifier';
import { getUsdJpyRate } from '../../currency-config';
import { computeSubscriptionUsage, getSubscriptionConfig } from '../../subscription-usage';
import type {
  AgentUsageBreakdown,
  BreakdownRow,
  DailyRoleCostPoint,
  RoleUsageEntry,
  CliAgentUsageEntry,
  RoleAccumulator,
} from './usage-breakdown-types';
import { normalizeRole, roleSortIndex } from './usage-breakdown-role';
import { emptyRoleAcc, isoDate, round6, round4 } from './usage-breakdown-helpers';

/**
 * Build the per-role usage breakdown for the last `windowDays` days.
 *
 * @param windowDays - Trailing window size (default 14) / 集計対象日数
 * @returns Aggregated usage per role plus daily stacked cost / 役割別集計
 */
export async function getAgentUsageBreakdown(windowDays = 14): Promise<AgentUsageBreakdown> {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1));

  const rows = (await prisma.agentExecution.findMany({
    where: { createdAt: { gte: cutoff } },
    select: {
      startedAt: true,
      createdAt: true,
      status: true,
      errorMessage: true,
      executionTimeMs: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadInputTokens: true,
      cacheCreationInputTokens: true,
      costUsd: true,
      llmCallCount: true,
      modelName: true,
      session: { select: { mode: true } },
      agentConfig: { select: { agentType: true } },
    },
  })) as unknown as BreakdownRow[];

  const roleMap = new Map<string, RoleAccumulator>();
  const agentMap = new Map<CliAgentKind, RoleAccumulator>();
  // Claude executions feed the subscription-window computation below.
  const claudeExecs: Array<{ at: Date; costUsd: number }> = [];
  // Pre-seed daily buckets so the stacked chart shows a continuous timeline.
  const dailyMap = new Map<string, DailyRoleCostPoint>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(cutoff);
    d.setUTCDate(cutoff.getUTCDate() + i);
    const key = isoDate(d);
    dailyMap.set(key, { date: key, totalCostUsd: 0, byRole: {} });
  }

  let totalCostUsd = 0;

  for (const r of rows) {
    const role = normalizeRole(r.session?.mode);
    const acc = roleMap.get(role) ?? emptyRoleAcc();
    const cost = toNumber(r.costUsd);
    const execTime = toInt(r.executionTimeMs);

    acc.executions += 1;
    if (r.status === 'failed' || r.errorMessage) acc.failed += 1;
    acc.costUsd += cost;
    acc.inputTokens += toInt(r.inputTokens);
    acc.outputTokens += toInt(r.outputTokens);
    acc.cacheRead += toInt(r.cacheReadInputTokens);
    acc.cacheCreation += toInt(r.cacheCreationInputTokens);
    acc.llmCalls += toInt(r.llmCallCount);
    if (execTime > 0) {
      acc.timeTotal += execTime;
      acc.timeSamples += 1;
    }
    roleMap.set(role, acc);

    // Same aggregation keyed by CLI agent (Claude Code / Codex / Gemini).
    const cliAgent = classifyCliAgent(r.modelName, r.agentConfig?.agentType);
    const agentAcc = agentMap.get(cliAgent) ?? emptyRoleAcc();
    agentAcc.executions += 1;
    if (r.status === 'failed' || r.errorMessage) agentAcc.failed += 1;
    agentAcc.costUsd += cost;
    agentAcc.inputTokens += toInt(r.inputTokens);
    agentAcc.outputTokens += toInt(r.outputTokens);
    agentAcc.cacheRead += toInt(r.cacheReadInputTokens);
    agentAcc.llmCalls += toInt(r.llmCallCount);
    if (execTime > 0) {
      agentAcc.timeTotal += execTime;
      agentAcc.timeSamples += 1;
    }
    agentMap.set(cliAgent, agentAcc);
    if (cliAgent === 'claude-code') {
      claudeExecs.push({ at: r.startedAt ?? r.createdAt, costUsd: cost });
    }

    totalCostUsd += cost;

    const bucket = dailyMap.get(isoDate(r.startedAt ?? r.createdAt));
    if (bucket && cost > 0) {
      bucket.totalCostUsd = round6(bucket.totalCostUsd + cost);
      bucket.byRole[role] = round6((bucket.byRole[role] ?? 0) + cost);
    }
  }

  const roles: RoleUsageEntry[] = Array.from(roleMap.entries())
    .map(([role, a]) => {
      const cacheableInput = a.inputTokens + a.cacheRead;
      return {
        role,
        executions: a.executions,
        failedExecutions: a.failed,
        costUsd: round6(a.costUsd),
        shareOfCost: totalCostUsd > 0 ? round4(a.costUsd / totalCostUsd) : 0,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        cacheReadInputTokens: a.cacheRead,
        cacheCreationInputTokens: a.cacheCreation,
        llmCalls: a.llmCalls,
        cacheHitRate: cacheableInput > 0 ? round4(a.cacheRead / cacheableInput) : 0,
        averageExecutionTimeMs: a.timeSamples > 0 ? Math.round(a.timeTotal / a.timeSamples) : null,
      };
    })
    .sort((a, b) => roleSortIndex(a.role) - roleSortIndex(b.role) || b.costUsd - a.costUsd);

  const agents: CliAgentUsageEntry[] = Array.from(agentMap.entries())
    .map(([agent, a]) => ({
      agent,
      executions: a.executions,
      failedExecutions: a.failed,
      costUsd: round6(a.costUsd),
      shareOfCost: totalCostUsd > 0 ? round4(a.costUsd / totalCostUsd) : 0,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cacheReadInputTokens: a.cacheRead,
      llmCalls: a.llmCalls,
      averageExecutionTimeMs: a.timeSamples > 0 ? Math.round(a.timeTotal / a.timeSamples) : null,
    }))
    .sort((a, b) => CLI_AGENT_ORDER.indexOf(a.agent) - CLI_AGENT_ORDER.indexOf(b.agent));

  const subCfg = getSubscriptionConfig();
  const subscription = subCfg.enabled ? computeSubscriptionUsage(claudeExecs, subCfg) : null;

  return {
    windowDays,
    totalCostUsd: round6(totalCostUsd),
    totalExecutions: rows.length,
    usdJpyRate: getUsdJpyRate(),
    roles,
    agents,
    subscription,
    dailyRoleCost: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Agent Usage Breakdown Queries
 *
 * Aggregates the per-execution metrics (costUsd, tokens, cache reads) by the
 * agent role that ran them — researcher / planner / implementer / verifier /
 * auto_verifier — using AgentSession.mode (`workflow-<role>`). Pure DB
 * aggregation of already-recorded real data; performs no LLM calls, so
 * rendering this breakdown adds zero API cost.
 */

import { prisma } from '../../../config/database';
import { toNumber, toInt } from './metric-coercion';
import { classifyCliAgent, CLI_AGENT_ORDER, type CliAgentKind } from './cli-agent-classifier';
import { getUsdJpyRate } from './currency-config';
import {
  computeSubscriptionUsage,
  getSubscriptionConfig,
  type SubscriptionUsage,
} from './subscription-usage';

/** Canonical display order for the workflow roles. Unknown roles sort after. */
export const KNOWN_ROLE_ORDER = [
  'researcher',
  'planner',
  'implementer',
  'verifier',
  'auto_verifier',
] as const;

export interface RoleUsageEntry {
  /** Normalized role name ('researcher', ..., or 'other' for null modes). */
  role: string;
  executions: number;
  failedExecutions: number;
  costUsd: number;
  /** This role's share of the window's total cost (0..1). */
  shareOfCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  llmCalls: number;
  /** cache_read / (cache_read + input) for this role. */
  cacheHitRate: number;
  averageExecutionTimeMs: number | null;
}

export interface DailyRoleCostPoint {
  /** ISO date (YYYY-MM-DD), UTC. */
  date: string;
  totalCostUsd: number;
  /** Cost per normalized role for that day (roles with 0 cost omitted). */
  byRole: Record<string, number>;
}

/** Usage aggregated per coding-CLI agent (Claude Code / Codex / Gemini). */
export interface CliAgentUsageEntry {
  agent: CliAgentKind;
  executions: number;
  failedExecutions: number;
  costUsd: number;
  /** This agent's share of the window's total cost (0..1). */
  shareOfCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  llmCalls: number;
  averageExecutionTimeMs: number | null;
}

export interface AgentUsageBreakdown {
  windowDays: number;
  totalCostUsd: number;
  totalExecutions: number;
  /** USD→JPY display rate (env RAPITAS_USD_JPY_RATE, default 150). */
  usdJpyRate: number;
  roles: RoleUsageEntry[];
  /** Per-CLI-agent breakdown; only agents with executions appear. */
  agents: CliAgentUsageEntry[];
  /** Claude subscription window state; null when disabled. */
  subscription: SubscriptionUsage | null;
  dailyRoleCost: DailyRoleCostPoint[];
}

interface BreakdownRow {
  startedAt: Date | null;
  createdAt: Date;
  status: string;
  errorMessage: string | null;
  executionTimeMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: unknown; // Prisma Decimal — stringified
  llmCallCount: number;
  modelName: string | null;
  session: { mode: string | null } | null;
  agentConfig: { agentType: string | null } | null;
}

/**
 * Normalize AgentSession.mode into a bare role name.
 *
 * @param mode - Raw session mode (e.g. "workflow-implementer") / セッションモード
 * @returns Role name without the "workflow-" prefix; 'other' for null / 役割名
 */
export function normalizeRole(mode: string | null | undefined): string {
  if (!mode) return 'other';
  return mode.startsWith('workflow-') ? mode.slice('workflow-'.length) : mode;
}

interface RoleAccumulator {
  executions: number;
  failed: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  llmCalls: number;
  timeTotal: number;
  timeSamples: number;
}

function emptyRoleAcc(): RoleAccumulator {
  return {
    executions: 0,
    failed: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheCreation: 0,
    llmCalls: 0,
    timeTotal: 0,
    timeSamples: 0,
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Sort roles canonically: known workflow roles first (in pipeline order),
 * then unknown roles by descending cost.
 */
function roleSortIndex(role: string): number {
  const idx = (KNOWN_ROLE_ORDER as readonly string[]).indexOf(role);
  return idx === -1 ? KNOWN_ROLE_ORDER.length : idx;
}

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

/**
 * Agent Usage Breakdown Types
 *
 * Shared type definitions for the usage-breakdown aggregation query.
 */

import type { CliAgentKind } from '../../cli-agent-classifier';
import type { SubscriptionUsage } from '../../subscription-usage';

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

export interface BreakdownRow {
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

export interface RoleAccumulator {
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

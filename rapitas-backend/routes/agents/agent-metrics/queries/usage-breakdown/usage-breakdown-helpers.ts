/**
 * Agent Usage Breakdown Numeric/Date Helpers
 *
 * Small pure helpers used while accumulating per-role and per-CLI-agent
 * usage stats.
 */

import type { RoleAccumulator } from './usage-breakdown-types';

export function emptyRoleAcc(): RoleAccumulator {
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

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

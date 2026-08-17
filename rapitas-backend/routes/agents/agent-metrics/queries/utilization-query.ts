/**
 * Agent Utilization Query
 *
 * Computes the per-role / per-CLI-agent busy ratio (utilization) from recorded
 * AgentExecution intervals: the union of execution intervals (overlaps counted
 * once) divided by the day length, bucketed per UTC day. Pure DB aggregation of
 * already-recorded data; performs no LLM calls and never exceeds 1.0.
 */

import { prisma } from '../../../../config/database';
import { toInt } from '../metric-coercion';
import { normalizeRole, KNOWN_ROLE_ORDER } from './usage-breakdown-query';
import { classifyCliAgent, CLI_AGENT_ORDER, type CliAgentKind } from '../cli-agent-classifier';

/** Milliseconds in one UTC day — the denominator of every daily ratio. */
const DAY_MS = 86_400_000;

/** Defensive cap on the pre-seeded day buckets for pathological date ranges. */
const MAX_WINDOW_DAYS = 366;

/** One day on the utilization timeline; ratios are 0..1 (union-based). */
export interface UtilizationDailyPoint {
  /** ISO date (YYYY-MM-DD), UTC. */
  date: string;
  /** Busy ratio per normalized role; every role seen in the window is present (0 when idle). */
  byRole: Record<string, number>;
  /** Busy ratio per CLI agent; every agent seen in the window is present (0 when idle). */
  byAgent: Record<string, number>;
}

export interface RoleUtilizationEntry {
  role: string;
  /** Window-wide busy ratio: union of intervals over the whole window / window length. */
  utilization: number;
}

export interface CliAgentUtilizationEntry {
  agent: CliAgentKind;
  /** Window-wide busy ratio: union of intervals over the whole window / window length. */
  utilization: number;
}

export interface AgentUtilization {
  /** ISO date (YYYY-MM-DD, UTC) of the first bucketed day. */
  startDate: string;
  /** ISO date (YYYY-MM-DD, UTC) of the last bucketed day (inclusive). */
  endDate: string;
  dayCount: number;
  daily: UtilizationDailyPoint[];
  roles: RoleUtilizationEntry[];
  agents: CliAgentUtilizationEntry[];
}

interface UtilizationRow {
  startedAt: Date | null;
  completedAt: Date | null;
  executionTimeMs: number | null;
  modelName: string | null;
  session: { mode: string | null } | null;
  agentConfig: { agentType: string | null } | null;
}

/** Closed execution interval in epoch ms; end is always > start. */
type Interval = [number, number];

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Parse a YYYY-MM-DD string as UTC midnight; null when absent or invalid. */
function parseUtcDate(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Total covered length of `intervals` within `[clipStart, clipEnd]`, counting
 * overlapping intervals once (interval union, not sum).
 *
 * @param intervals - Raw (possibly overlapping) intervals in epoch ms / 区間の配列
 * @param clipStart - Clip window start (inclusive, epoch ms) / クリップ開始
 * @param clipEnd - Clip window end (exclusive, epoch ms) / クリップ終了
 * @returns Union length in ms, 0..(clipEnd-clipStart) / 和集合の長さ
 */
export function unionLength(intervals: Interval[], clipStart: number, clipEnd: number): number {
  const clipped: Interval[] = [];
  for (const [s, e] of intervals) {
    const cs = Math.max(s, clipStart);
    const ce = Math.min(e, clipEnd);
    if (ce > cs) clipped.push([cs, ce]);
  }
  if (clipped.length === 0) return 0;
  clipped.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = clipped[0];
  for (let i = 1; i < clipped.length; i++) {
    const [s, e] = clipped[i];
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e;
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total;
}

function roleSortIndex(role: string): number {
  const idx = (KNOWN_ROLE_ORDER as readonly string[]).indexOf(role);
  return idx === -1 ? KNOWN_ROLE_ORDER.length : idx;
}

/**
 * Compute per-role / per-CLI-agent daily utilization for the given date range.
 *
 * Definition (must match verify.md): busy ratio = union length of the role's
 * execution intervals within a UTC day / 86,400,000 ms, clipped to [0, 1].
 * In-flight executions (completedAt null) are excluded; a null startedAt is
 * reconstructed as completedAt − executionTimeMs.
 *
 * @param range - Optional YYYY-MM-DD bounds; defaults to the trailing 7 days / 集計範囲
 * @returns Daily and window-wide utilization per role and CLI agent / 稼働率集計
 */
export async function getAgentUtilization(
  range: { startDate?: string; endDate?: string } = {},
): Promise<AgentUtilization> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const endDayStart = parseUtcDate(range.endDate) ?? todayStart.getTime();
  let firstDayStart = parseUtcDate(range.startDate) ?? endDayStart - 6 * DAY_MS;
  if (firstDayStart > endDayStart) firstDayStart = endDayStart;
  // Clamp pathological ranges so the per-day pre-seed loop stays bounded.
  if ((endDayStart - firstDayStart) / DAY_MS + 1 > MAX_WINDOW_DAYS) {
    firstDayStart = endDayStart - (MAX_WINDOW_DAYS - 1) * DAY_MS;
  }
  const windowStart = firstDayStart;
  const windowEnd = endDayStart + DAY_MS; // exclusive
  const dayCount = Math.round((windowEnd - windowStart) / DAY_MS);

  // No upper completedAt bound: rows completing after windowEnd still overlap
  // the window and contribute their clipped portion.
  const rows = (await prisma.agentExecution.findMany({
    where: { completedAt: { gte: new Date(windowStart) } },
    select: {
      startedAt: true,
      completedAt: true,
      executionTimeMs: true,
      modelName: true,
      session: { select: { mode: true } },
      agentConfig: { select: { agentType: true } },
    },
  })) as unknown as UtilizationRow[];

  const roleIntervals = new Map<string, Interval[]>();
  const agentIntervals = new Map<CliAgentKind, Interval[]>();

  for (const r of rows) {
    if (!r.completedAt) continue; // in-flight: final length undetermined
    const end = r.completedAt.getTime();
    const execMs = toInt(r.executionTimeMs);
    // startedAt null is reconstructed from completedAt − executionTimeMs.
    const start = r.startedAt ? r.startedAt.getTime() : execMs > 0 ? end - execMs : null;
    if (start === null || start >= end) continue;
    if (end <= windowStart || start >= windowEnd) continue;

    const interval: Interval = [Math.max(start, windowStart), Math.min(end, windowEnd)];

    const role = normalizeRole(r.session?.mode);
    const roleList = roleIntervals.get(role) ?? [];
    roleList.push(interval);
    roleIntervals.set(role, roleList);

    const agent = classifyCliAgent(r.modelName, r.agentConfig?.agentType);
    const agentList = agentIntervals.get(agent) ?? [];
    agentList.push(interval);
    agentIntervals.set(agent, agentList);
  }

  const daily: UtilizationDailyPoint[] = [];
  for (let i = 0; i < dayCount; i++) {
    const dayStart = windowStart + i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const byRole: Record<string, number> = {};
    for (const [role, intervals] of roleIntervals) {
      byRole[role] = round4(Math.min(1, unionLength(intervals, dayStart, dayEnd) / DAY_MS));
    }
    const byAgent: Record<string, number> = {};
    for (const [agent, intervals] of agentIntervals) {
      byAgent[agent] = round4(Math.min(1, unionLength(intervals, dayStart, dayEnd) / DAY_MS));
    }
    daily.push({ date: isoDate(dayStart), byRole, byAgent });
  }

  const windowLen = windowEnd - windowStart;
  const roles: RoleUtilizationEntry[] = Array.from(roleIntervals.entries())
    .map(([role, intervals]) => ({
      role,
      utilization: round4(Math.min(1, unionLength(intervals, windowStart, windowEnd) / windowLen)),
    }))
    .sort((a, b) => roleSortIndex(a.role) - roleSortIndex(b.role) || b.utilization - a.utilization);

  const agents: CliAgentUtilizationEntry[] = Array.from(agentIntervals.entries())
    .map(([agent, intervals]) => ({
      agent,
      utilization: round4(Math.min(1, unionLength(intervals, windowStart, windowEnd) / windowLen)),
    }))
    .sort((a, b) => CLI_AGENT_ORDER.indexOf(a.agent) - CLI_AGENT_ORDER.indexOf(b.agent));

  return {
    startDate: isoDate(windowStart),
    endDate: isoDate(endDayStart),
    dayCount,
    daily,
    roles,
    agents,
  };
}

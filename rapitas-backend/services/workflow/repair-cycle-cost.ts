/**
 * repair-cycle-cost
 *
 * Pure functions computing per-repair-cycle cost, cache usage and unit cost
 * from already-fetched execution rows and repair-bounce timestamps. Sibling of
 * repair-iteration-metrics, which owns change-set size and dwell time and
 * deliberately left the money axis out of its MVP. Not responsible for DB
 * access — callers query WorkflowTransition/AgentExecution and pass rows in.
 *
 * Why it exists. The per-cycle numbers were only reachable by hand-writing SQL
 * after the fact, and on 2026-10-13 that gap produced three wrong conclusions
 * in a row about where a repair loop's money went.
 *
 * What it surfaces, measured on #1214 with cost attributed incrementally (the
 * session-cumulative defect fixed in execution-cost-attribution):
 *
 *   cycle 1  95 calls  out 117,902  $2.89  $0.030/call
 *   cycle 2  79 calls  out 154,237  $4.16  $0.053/call
 *   cycle 3   9 calls  out  58,126  $2.37  $0.264/call
 *   cycle 4  15 calls  out  17,393  $5.40  $0.360/call
 *
 * Unit cost rose 11.8x while the work per cycle collapsed — the last cycle
 * produced a seventh of the first cycle's output for nearly twice the money.
 * Across 130 tasks with 2+ priced cycles the median ratio is 1.18x, but 31
 * (24%) exceed 2x and the worst offenders are also the most expensive tasks
 * (#1107 $49.85, #881 $36.45, #971 $35.35). Hence the default threshold of 2.
 */

import { attributeIncrementalCosts } from '../agents/execution-cost-attribution';

/** One AgentExecution row, as the caller fetched it. */
export interface RawCycleExecution {
  startedAt: Date | string | null;
  /** The CLI's session-cumulative total_cost_usd; attributed, never summed. */
  costUsd: unknown;
  claudeSessionId: string | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  outputTokens?: number | null;
  llmCallCount?: number | null;
}

/** What one repair cycle consumed. */
export interface RepairCycleCost {
  /** 1-based; cycle 1 is the work before the first bounce. / 1始まり */
  cycle: number;
  executions: number;
  llmCalls: number;
  cacheRead: number;
  cacheCreate: number;
  outputTokens: number;
  /** Incremental spend attributed to this cycle. / この周の実支出 */
  costUsd: number;
  /** null when the cycle made no LLM call — never a division by zero. / 呼び出し0なら null */
  costPerLlmCall: number | null;
}

/** Whether unit cost is drifting up across cycles. */
export interface UnitCostTrend {
  worsening: boolean;
  firstPerCall: number | null;
  lastPerCall: number | null;
  ratio: number | null;
}

/** Non-negative integer, 0 for anything unusable. */
function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Epoch ms, or null when the row has not started. */
function startedMs(value: Date | string | null): number | null {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Bucket a task's executions into repair cycles and total each one.
 *
 * A bounce timestamp OPENS the next cycle, so an execution starting at exactly
 * that instant belongs to the new cycle — it is the retry, not the attempt that
 * was rejected. An execution with no start time is the one about to run, so it
 * lands in the latest cycle.
 *
 * Cycles with no executions produce no row: reporting a cycle that consumed
 * nothing would invite reading a gap as free work.
 *
 * @param bounceTimes - Repair-bounce timestamps, any order / 差し戻し時刻
 * @param executions - The task's executions, any order / 実行行
 * @returns One row per cycle that actually ran, ascending / 周ごとの集計
 */
export function computeRepairCycleCosts(
  bounceTimes: readonly (Date | string)[],
  executions: readonly RawCycleExecution[],
): RepairCycleCost[] {
  if (executions.length === 0) return [];

  const bounds = bounceTimes
    .map((t) => startedMs(t))
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b);

  const increments = attributeIncrementalCosts(
    executions.map((e) => ({
      costUsd: e.costUsd,
      claudeSessionId: e.claudeSessionId,
      startedAt: e.startedAt === null ? null : new Date(startedMs(e.startedAt) ?? 0),
    })),
  );

  const buckets = new Map<number, RepairCycleCost>();
  executions.forEach((execution, index) => {
    const started = startedMs(execution.startedAt);
    // No start time: the pending run, which belongs to the latest cycle.
    let cycle = bounds.length + 1;
    if (started !== null) {
      cycle = 1;
      for (const bound of bounds) if (started >= bound) cycle++;
    }
    const row =
      buckets.get(cycle) ??
      ({
        cycle,
        executions: 0,
        llmCalls: 0,
        cacheRead: 0,
        cacheCreate: 0,
        outputTokens: 0,
        costUsd: 0,
        costPerLlmCall: null,
      } satisfies RepairCycleCost);
    row.executions++;
    row.llmCalls += count(execution.llmCallCount);
    row.cacheRead += count(execution.cacheReadInputTokens);
    row.cacheCreate += count(execution.cacheCreationInputTokens);
    row.outputTokens += count(execution.outputTokens);
    row.costUsd += increments[index];
    buckets.set(cycle, row);
  });

  const rows = [...buckets.values()].sort((a, b) => a.cycle - b.cycle);
  for (const row of rows) {
    row.costPerLlmCall = row.llmCalls > 0 ? row.costUsd / row.llmCalls : null;
  }
  return rows;
}

/** Unit-cost ratio above which the drift is worth surfacing (median is 1.18x). */
export const DEFAULT_UNIT_COST_WORSENING_RATIO = 2;

/**
 * Compare the first and last priceable cycles' unit cost.
 *
 * Cycles that made no LLM call are skipped rather than treated as free: they
 * have no unit cost to compare, and letting one sit at either end would invent
 * a trend. Fewer than two priceable cycles means no judgement — a single cycle
 * cannot drift.
 *
 * @param cycles - Rows from {@link computeRepairCycleCosts} / 周ごとの集計
 * @param ratio - Threshold; default from the measured distribution / 閾値
 * @returns The trend, or all-null when it cannot be judged / 判定
 */
export function detectUnitCostTrend(
  cycles: readonly RepairCycleCost[],
  ratio: number = DEFAULT_UNIT_COST_WORSENING_RATIO,
): UnitCostTrend {
  const priced = cycles
    .filter((c) => c.costPerLlmCall !== null && c.costPerLlmCall > 0)
    .sort((a, b) => a.cycle - b.cycle);
  if (priced.length < 2) {
    return { worsening: false, firstPerCall: null, lastPerCall: null, ratio: null };
  }
  const firstPerCall = priced[0].costPerLlmCall as number;
  const lastPerCall = priced[priced.length - 1].costPerLlmCall as number;
  const observed = lastPerCall / firstPerCall;
  return { worsening: observed >= ratio, firstPerCall, lastPerCall, ratio: observed };
}

/**
 * Pareto Dominance
 *
 * Marks the non-dominated set of frontier points under three objectives:
 * minimise execution time, maximise success rate, minimise resource cost.
 * Pure function; unreliable points never dominate and are never optimal.
 */

import type { ParetoPoint } from './pareto-frontier-types';

/** The three objective values of a point, in comparable units. */
export interface Objectives {
  time: number;
  success: number;
  cost: number;
}

/**
 * Extracts the objective triple from a point.
 *
 * @param point - Frontier point / 点
 * @returns Objective values / 目的関数値
 */
export function objectivesOf(point: ParetoPoint): Objectives {
  return {
    time: point.executionTimeMs.value,
    success: point.successRate.value,
    cost: point.costUsd.value,
  };
}

/**
 * True when `a` is at least as good as `b` on every objective and strictly
 * better on at least one. Identical points do not dominate each other, so
 * duplicates both stay on the frontier.
 *
 * @param a - Candidate dominator / 支配側
 * @param b - Candidate dominated point / 被支配側
 * @returns Whether a dominates b / a が b を支配するか
 */
export function dominates(a: Objectives, b: Objectives): boolean {
  const noWorse = a.time <= b.time && a.success >= b.success && a.cost <= b.cost;
  const strictlyBetter = a.time < b.time || a.success > b.success || a.cost < b.cost;
  return noWorse && strictlyBetter;
}

/**
 * Returns a copy of `points` with `paretoOptimal` set for the non-dominated
 * reliable points. Only reliable points participate: a point backed by too
 * few executions can neither be recommended nor knock a real candidate off
 * the frontier.
 *
 * @param points - Segment points / セグメント内の点
 * @returns Same points with paretoOptimal filled in / 判定済みの点
 */
export function markParetoOptimal(points: ParetoPoint[]): ParetoPoint[] {
  const reliable = points.filter((p) => p.reliable);
  return points.map((point) => {
    if (!point.reliable) return { ...point, paretoOptimal: false };
    const self = objectivesOf(point);
    const dominated = reliable.some(
      (other) => other !== point && dominates(objectivesOf(other), self),
    );
    return { ...point, paretoOptimal: !dominated };
  });
}

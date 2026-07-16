/**
 * coverage-floor.ts
 *
 * Coverage-floor enforcement for CI test-suite gates (ADR-0002 Phase B).
 * Parses the lcov report written by `bun test --coverage` and fails the gate
 * when aggregate coverage falls below the floor declared in ci-gates.ts.
 * Not responsible for running tests or deciding when the floor applies —
 * run-gate.ts owns that (full-manifest runs only).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { TestSuiteGate } from './ci-gates';

/** Aggregate line/function totals summed across every SF record in an lcov file. */
export interface LcovTotals {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
}

/**
 * Sums LF/LH/FNF/FNH counters across all file records of an lcov report.
 * Pure function exported for unit testing.
 *
 * @param lcovText - Raw contents of an lcov.info file / lcov.info の生テキスト
 * @returns Aggregate totals across all files in the report
 */
export function parseLcovTotals(lcovText: string): LcovTotals {
  const totals: LcovTotals = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
  for (const line of lcovText.split('\n')) {
    if (line.startsWith('LF:')) totals.linesFound += Number(line.slice(3)) || 0;
    else if (line.startsWith('LH:')) totals.linesHit += Number(line.slice(3)) || 0;
    else if (line.startsWith('FNF:')) totals.functionsFound += Number(line.slice(4)) || 0;
    else if (line.startsWith('FNH:')) totals.functionsHit += Number(line.slice(4)) || 0;
  }
  return totals;
}

/**
 * Compares aggregate lcov totals against a gate's coverage floor.
 * Pure function exported for unit testing.
 *
 * Zero-denominator totals compute as 0% — an empty lcov report must FAIL a
 * positive floor, not pass it (an empty report means coverage never ran).
 *
 * @param totals - Aggregate totals from parseLcovTotals / lcov 集計値
 * @param floor - Minimum percentages from the gate definition / ゲート定義のフロア
 * @returns Pass/fail plus the computed percentages for reporting
 */
export function checkCoverageFloor(
  totals: LcovTotals,
  floor: { linesPct: number; functionsPct: number },
): { ok: boolean; linesPct: number; functionsPct: number } {
  const linesPct = totals.linesFound > 0 ? (totals.linesHit / totals.linesFound) * 100 : 0;
  const functionsPct =
    totals.functionsFound > 0 ? (totals.functionsHit / totals.functionsFound) * 100 : 0;
  return {
    ok: linesPct >= floor.linesPct && functionsPct >= floor.functionsPct,
    linesPct,
    functionsPct,
  };
}

/**
 * Enforces a gate's coverage floor from the lcov report written by the test run.
 *
 * A missing lcov.info is a hard failure, not a skip: it means '--coverage' was
 * silently disabled again (e.g. the bunfig `coverage = false` override that
 * killed measurement for months, fixed 2026-07-16) — exactly the regression
 * this guard exists to catch.
 *
 * @param gate - Gate whose coverageFloor to enforce / フロアを強制するゲート
 * @param backendDir - Backend root the coverage dir is relative to / バックエンドルート
 * @returns 0 when the floor is met, 1 otherwise
 */
export function enforceCoverageFloor(gate: TestSuiteGate, backendDir: string): number {
  const floor = gate.coverageFloor;
  if (!floor) return 0;

  // NOTE: Path mirrors bunfig.toml's coverageDir = "coverage" + lcov reporter.
  const lcovPath = resolve(backendDir, 'coverage', 'lcov.info');
  let lcovText: string;
  try {
    lcovText = readFileSync(lcovPath, 'utf-8');
  } catch {
    console.error(
      `[run-gate] Coverage floor is configured but ${lcovPath} was not written. ` +
        `Coverage measurement is broken (is '--coverage' in the gate args? does bunfig disable it?). ` +
        `Failing the gate to prevent a false green.`,
    );
    return 1;
  }

  const result = checkCoverageFloor(parseLcovTotals(lcovText), floor);
  const summary =
    `lines ${result.linesPct.toFixed(2)}% (floor ${floor.linesPct}%), ` +
    `functions ${result.functionsPct.toFixed(2)}% (floor ${floor.functionsPct}%)`;

  if (!result.ok) {
    console.error(`[run-gate] Coverage floor NOT met: ${summary}`);
    console.error(
      '[run-gate] Per ADR-0002: add tests for the affected module — do not lower the floor.',
    );
    return 1;
  }

  console.log(`[run-gate] Coverage floor met: ${summary}`);
  return 0;
}

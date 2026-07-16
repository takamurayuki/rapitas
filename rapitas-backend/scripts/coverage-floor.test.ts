/**
 * coverage-floor.test.ts
 *
 * Unit tests for the ADR-0002 Phase B coverage floor: lcov aggregation,
 * floor comparison (including the empty-report-must-fail rule), and
 * enforceCoverageFloor's missing-lcov hard failure.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'bun:test';
import type { TestSuiteGate } from './ci-gates';
import { checkCoverageFloor, enforceCoverageFloor, parseLcovTotals } from './coverage-floor';

const SAMPLE_LCOV = [
  'TN:',
  'SF:services/a.ts',
  'FNF:4',
  'FNH:2',
  'DA:1,1',
  'LF:10',
  'LH:8',
  'end_of_record',
  'TN:',
  'SF:services/b.ts',
  'FNF:6',
  'FNH:3',
  'LF:30',
  'LH:12',
  'end_of_record',
  '',
].join('\n');

describe('parseLcovTotals', () => {
  it('sums LF/LH/FNF/FNH across all file records', () => {
    expect(parseLcovTotals(SAMPLE_LCOV)).toEqual({
      linesFound: 40,
      linesHit: 20,
      functionsFound: 10,
      functionsHit: 5,
    });
  });

  it('returns zero totals for an empty report', () => {
    expect(parseLcovTotals('')).toEqual({
      linesFound: 0,
      linesHit: 0,
      functionsFound: 0,
      functionsHit: 0,
    });
  });

  it('ignores malformed counter values instead of producing NaN', () => {
    const totals = parseLcovTotals('LF:abc\nLH:5\nFNF:2\nFNH:1\n');
    expect(totals.linesFound).toBe(0);
    expect(totals.linesHit).toBe(5);
  });
});

describe('checkCoverageFloor', () => {
  const totals = { linesFound: 40, linesHit: 20, functionsFound: 10, functionsHit: 5 };

  it('passes when both percentages meet the floor', () => {
    const result = checkCoverageFloor(totals, { linesPct: 50, functionsPct: 50 });
    expect(result).toEqual({ ok: true, linesPct: 50, functionsPct: 50 });
  });

  it('fails when lines are below the floor', () => {
    expect(checkCoverageFloor(totals, { linesPct: 51, functionsPct: 40 }).ok).toBe(false);
  });

  it('fails when functions are below the floor', () => {
    expect(checkCoverageFloor(totals, { linesPct: 40, functionsPct: 51 }).ok).toBe(false);
  });

  it('an empty report fails a positive floor (coverage never ran)', () => {
    const empty = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
    expect(checkCoverageFloor(empty, { linesPct: 1, functionsPct: 1 }).ok).toBe(false);
  });
});

describe('enforceCoverageFloor', () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function gateWithFloor(floor?: TestSuiteGate['coverageFloor']): TestSuiteGate {
    return {
      kind: 'test-suite',
      id: 'floor-test',
      description: 'test gate',
      manifest: 'unused.txt',
      coverageFloor: floor,
    };
  }

  function tempBackendDir(lcovText?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'coverage-floor-'));
    tempDirs.push(dir);
    if (lcovText !== undefined) {
      mkdirSync(join(dir, 'coverage'), { recursive: true });
      writeFileSync(join(dir, 'coverage', 'lcov.info'), lcovText);
    }
    return dir;
  }

  it('returns 0 when no floor is configured', () => {
    expect(enforceCoverageFloor(gateWithFloor(undefined), tempBackendDir())).toBe(0);
  });

  it('returns 1 when lcov.info is missing (broken measurement must not false-green)', () => {
    const gate = gateWithFloor({ linesPct: 1, functionsPct: 1 });
    expect(enforceCoverageFloor(gate, tempBackendDir())).toBe(1);
  });

  it('returns 0 when the report meets the floor', () => {
    const gate = gateWithFloor({ linesPct: 45, functionsPct: 45 });
    expect(enforceCoverageFloor(gate, tempBackendDir(SAMPLE_LCOV))).toBe(0);
  });

  it('returns 1 when the report is below the floor', () => {
    const gate = gateWithFloor({ linesPct: 90, functionsPct: 90 });
    expect(enforceCoverageFloor(gate, tempBackendDir(SAMPLE_LCOV))).toBe(1);
  });
});

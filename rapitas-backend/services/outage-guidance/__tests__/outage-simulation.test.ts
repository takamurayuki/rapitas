/**
 * outage-simulation tests — back-test accuracy against past incidents,
 * inverted-label failure, insufficient data, no future leakage and label
 * override.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { simulate, expectedVerdict } from '../outage-simulation';
import { validateInventory } from '../inventory-loader';
import type { IncidentRecord, OutageInventory, OutageVerdict } from '../outage-guidance.types';

const FIXTURE = join(import.meta.dir, '__fixtures__', 'team-inventory.json');

function fixture(): OutageInventory {
  return validateInventory(JSON.parse(readFileSync(FIXTURE, 'utf8')));
}

const NOW = new Date('2026-09-24T00:00:00Z');

describe('simulate (fixture)', () => {
  test('reaches >= 90% accuracy against past incidents and passes', () => {
    const report = simulate(fixture(), NOW);
    expect(report.total).toBeGreaterThanOrEqual(20);
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.status).toBe('passed');
    expect(report.threshold).toBe(0.9);
    expect(report.correct).toBe(report.total - report.mismatches.length);
    expect(report.evaluatedAt).toBe(NOW.toISOString());
    const confusionTotal = Object.values(report.confusion)
      .flatMap((row) => Object.values(row))
      .reduce((a, b) => a + b, 0);
    expect(confusionTotal).toBe(report.total);
  });

  test('inverted ground-truth labels make the back-test fail', () => {
    const inv = fixture();
    const invert: Record<OutageVerdict, OutageVerdict> = {
      safe: 'danger',
      danger: 'safe',
      risk: 'danger',
    };
    const inverted: OutageInventory = {
      ...inv,
      incidents: inv.incidents.map((i) => ({ ...i, label: invert[expectedVerdict(inv, i)] })),
    };
    const report = simulate(inverted, NOW);
    expect(report.status).toBe('failed');
    expect(report.accuracy).toBeLessThan(0.5);
  });

  test('fewer than 10 incidents is insufficient_data, never passed', () => {
    const inv = fixture();
    const report = simulate({ ...inv, incidents: inv.incidents.slice(0, 9) }, NOW);
    expect(report.total).toBe(9);
    expect(report.status).toBe('insufficient_data');
  });
});

describe('simulate (synthetic)', () => {
  const base: OutageInventory = {
    version: 1,
    services: [
      { id: 'job', name: 'Job', layer: 'worker', slaMinutes: 600, declaredRecoveryMinutes: 30 },
      { id: 'other', name: 'Other', layer: 'api', slaMinutes: 60, declaredRecoveryMinutes: 5 },
    ],
    dependencies: [],
    incidents: [],
  };
  const inc = (n: number, minutes: number, label?: OutageVerdict): IncidentRecord => ({
    id: `i${n}`,
    targetServiceId: 'job',
    occurredAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    actualRecoveryMinutes: minutes,
    actualImpactedServiceIds: [],
    ...(label ? { label } : {}),
  });

  test('only earlier incidents feed the history (no future leakage)', () => {
    // Listed newest-first to prove the simulator sorts by occurredAt.
    const incidents = [inc(4, 20), inc(3, 20), inc(2, 20), inc(1, 20)];
    const report = simulate({ ...base, incidents }, NOW);
    // First three predictions lack 3 prior samples → risk while truth is safe.
    expect(report.mismatches.map((m) => m.incidentId)).toEqual(['i1', 'i2', 'i3']);
    expect(report.mismatches.every((m) => m.predicted === 'risk' && m.expected === 'safe')).toBe(
      true,
    );
  });

  test('explicit label overrides the derived ground truth', () => {
    const plain = inc(1, 20);
    expect(expectedVerdict(base, plain)).toBe('safe');
    expect(expectedVerdict(base, { ...plain, label: 'danger' })).toBe('danger');
  });

  test('ground truth uses actual impact, not the graph', () => {
    const withEdge: OutageInventory = {
      ...base,
      dependencies: [{ from: 'other', to: 'job', kind: 'api_call' }],
    };
    // Actual impact excluded `other`, so tolerance stays at job's own 600.
    expect(expectedVerdict(withEdge, inc(1, 100))).toBe('safe');
    expect(expectedVerdict(withEdge, { ...inc(1, 100), actualImpactedServiceIds: ['other'] })).toBe(
      'danger',
    );
  });
});

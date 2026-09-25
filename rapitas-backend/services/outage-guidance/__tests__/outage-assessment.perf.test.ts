/**
 * outage-assessment performance tests — the real-time requirement: every
 * assessment (graph traversal + classification) completes within 100ms, both
 * for the fixture team and for a synthetic 200-node / 1000-edge worst case.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import {
  assessOutage,
  assessOutageInInventory,
  ServiceNotFoundError,
} from '../outage-assessment-service';
import { clearInventoryCache, loadInventory } from '../inventory-loader';
import type { OutageInventory } from '../outage-guidance.types';

const FIXTURE = join(import.meta.dir, '__fixtures__', 'team-inventory.json');
const BUDGET_MS = 100;

describe('assessOutage (fixture)', () => {
  const prev = process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
  beforeAll(() => {
    process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = FIXTURE;
    clearInventoryCache();
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
    else process.env.RAPITAS_OUTAGE_GUIDANCE_FILE = prev;
  });

  test('1000 rounds over every service stay under 100ms each', async () => {
    const { inventory } = await loadInventory();
    const ids = inventory.services.map((s) => s.id);
    let worst = 0;
    for (let round = 0; round < 1000; round++) {
      for (const id of ids) {
        const assessment = await assessOutage(id);
        worst = Math.max(worst, assessment.computedInMs);
      }
    }
    expect(worst).toBeLessThan(BUDGET_MS);
  });

  test('returns a three-level verdict with evidence for the shared cache', async () => {
    const assessment = await assessOutage('session-cache');
    expect(assessment.verdict).toBe('danger');
    expect(assessment.reasons).toContain('wide_blast_radius');
    expect(assessment.affected.length).toBe(7);
    expect(assessment.affected.every((a) => a.path.at(-1) === 'session-cache')).toBe(true);
  });

  test('unknown service throws ServiceNotFoundError', async () => {
    await expect(assessOutage('nope')).rejects.toBeInstanceOf(ServiceNotFoundError);
  });
});

describe('assessOutageInInventory (synthetic worst case)', () => {
  test('200 nodes / 1000 edges stays under 100ms', () => {
    const n = 200;
    const services = Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      layer: 'api' as const,
      slaMinutes: 30 + (i % 50),
      declaredRecoveryMinutes: 10,
    }));
    const dependencies: OutageInventory['dependencies'] = [];
    // Deterministic pseudo-random edges pointing "downward" so s0 is the root
    // everything transitively depends on — the widest possible blast radius.
    let seed = 7;
    while (dependencies.length < 1000) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const from = 1 + (seed % (n - 1));
      const to = seed % from;
      dependencies.push({ from: `s${from}`, to: `s${to}`, kind: 'api_call' });
    }
    const incidents = Array.from({ length: 50 }, (_, i) => ({
      id: `i${i}`,
      targetServiceId: 's0',
      occurredAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      actualRecoveryMinutes: 5 + i,
      actualImpactedServiceIds: [],
    }));
    const inv: OutageInventory = { version: 1, services, dependencies, incidents };
    let worst = 0;
    for (let k = 0; k < 20; k++) {
      const a = assessOutageInInventory(inv, 's0');
      worst = Math.max(worst, a.computedInMs);
      expect(a.affected.length).toBeGreaterThan(100);
    }
    expect(worst).toBeLessThan(BUDGET_MS);
  });
});

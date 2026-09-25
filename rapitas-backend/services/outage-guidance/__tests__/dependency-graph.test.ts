/**
 * dependency-graph tests — reverse reachability, shortest evidence paths,
 * cycle termination and isolated nodes.
 */
import { describe, test, expect } from 'bun:test';
import { computeImpact } from '../dependency-graph';
import type { OutageInventory, ServiceDependency } from '../outage-guidance.types';

function inventoryOf(ids: string[], deps: Array<[string, string]>): OutageInventory {
  return {
    version: 1,
    services: ids.map((id) => ({
      id,
      name: id.toUpperCase(),
      layer: 'api',
      slaMinutes: 30,
      declaredRecoveryMinutes: 10,
    })),
    dependencies: deps.map(([from, to]): ServiceDependency => ({ from, to, kind: 'api_call' })),
    incidents: [],
  };
}

describe('computeImpact', () => {
  test('chain a→b→c: stopping c impacts b (depth1) then a (depth2)', () => {
    const inv = inventoryOf(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    const affected = computeImpact(inv, 'c');
    expect(affected).toEqual([
      { serviceId: 'b', depth: 1, path: ['b', 'c'] },
      { serviceId: 'a', depth: 2, path: ['a', 'b', 'c'] },
    ]);
  });

  test('diamond: picks the shortest evidence path', () => {
    // a depends on d directly and via b→c→d.
    const inv = inventoryOf(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
        ['a', 'd'],
      ],
    );
    const affected = computeImpact(inv, 'd');
    const a = affected.find((x) => x.serviceId === 'a');
    expect(a).toEqual({ serviceId: 'a', depth: 1, path: ['a', 'd'] });
    expect(affected.map((x) => x.serviceId)).toEqual(['a', 'c', 'b']);
  });

  test('cycle a⇄b terminates and includes the other node', () => {
    const inv = inventoryOf(
      ['a', 'b'],
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
    );
    expect(computeImpact(inv, 'a')).toEqual([{ serviceId: 'b', depth: 1, path: ['b', 'a'] }]);
  });

  test('isolated node has no impact', () => {
    const inv = inventoryOf(['a', 'b', 'lonely'], [['a', 'b']]);
    expect(computeImpact(inv, 'lonely')).toEqual([]);
  });

  test('same depth is ordered by service id', () => {
    const inv = inventoryOf(
      ['z', 'm', 'a', 't'],
      [
        ['z', 't'],
        ['m', 't'],
        ['a', 't'],
      ],
    );
    expect(computeImpact(inv, 't').map((x) => x.serviceId)).toEqual(['a', 'm', 'z']);
  });
});

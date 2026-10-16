/**
 * lineage-builder unit tests
 *
 * Window edges, evidence classes, tie-breaking, same-timestamp safety and
 * the known branch-conflict -> push-rejected -> retry-stopped rule chain.
 */
import { describe, test, expect } from 'bun:test';
import {
  buildClusters,
  buildEdges,
  buildNodes,
  CONFIDENCE_BY_BASIS,
  PARENT_WINDOW_MS,
} from '../lineage-builder';
import type { RawLogRow } from '../failure-lineage-types';

const T0 = Date.UTC(2026, 9, 15, 0, 0, 0);

function row(id: number, text: string, atMs: number, executionId = 1, seq = id): RawLogRow {
  return {
    id,
    executionId,
    logChunk: text,
    logType: 'stdout',
    sequenceNumber: seq,
    timestamp: atMs,
  };
}

describe('buildNodes', () => {
  test('keeps only ERROR/WARN rows and sorts by time', () => {
    const nodes = buildNodes([
      row(2, 'ERROR b', T0 + 1000),
      row(1, 'info only', T0),
      row(3, 'WARN a', T0 + 500),
    ]);
    expect(nodes.map((n) => n.id)).toEqual(['log-3', 'log-2']);
    expect(nodes[0].level).toBe('WARN');
  });

  test('returns empty for empty input', () => {
    expect(buildNodes([])).toEqual([]);
  });
});

describe('buildEdges', () => {
  test('known chain links with rule confidence 0.9 (conflict -> push rejected -> retry stopped)', () => {
    const nodes = buildNodes([
      row(1, 'ERROR merge conflict in feature/t1-a', T0),
      row(2, 'ERROR git push rejected for feature/t1-a (non-fast-forward)', T0 + 20_000),
      row(3, 'WARN retry limit reached, giving up', T0 + 60_000),
    ]);
    const edges = buildEdges(nodes);
    expect(nodes).toHaveLength(3);
    expect(edges).toEqual([
      expect.objectContaining({
        parentId: 'log-1',
        childId: 'log-2',
        confidence: 0.9,
        basis: 'rule',
      }),
      expect.objectContaining({
        parentId: 'log-2',
        childId: 'log-3',
        confidence: 0.9,
        basis: 'rule',
      }),
    ]);
  });

  test('falls back to same_execution, same_resource and time_proximity in that order', () => {
    const sameExec = buildEdges(
      buildNodes([row(1, 'ERROR a', T0, 1), row(2, 'ERROR b', T0 + 1000, 1)]),
    );
    expect(sameExec[0].basis).toBe('same_execution');
    expect(sameExec[0].confidence).toBe(CONFIDENCE_BY_BASIS.same_execution);

    const sameRes = buildEdges(
      buildNodes([row(1, 'ERROR task 5 a', T0, 1), row(2, 'ERROR task 5 b', T0 + 1000, 2)]),
    );
    expect(sameRes[0].basis).toBe('same_resource');
    expect(sameRes[0].confidence).toBe(0.3);

    const time = buildEdges(
      buildNodes([row(1, 'ERROR a', T0, 1), row(2, 'ERROR b', T0 + 1000, 2)]),
    );
    expect(time[0].basis).toBe('time_proximity');
    expect(time[0].confidence).toBe(0.15);
  });

  test('window boundary: exactly W is a candidate, W+1ms is not', () => {
    const inside = buildEdges(
      buildNodes([row(1, 'ERROR a', T0), row(2, 'ERROR b', T0 + PARENT_WINDOW_MS)]),
    );
    expect(inside).toHaveLength(1);
    const outside = buildEdges(
      buildNodes([row(1, 'ERROR a', T0), row(2, 'ERROR b', T0 + PARENT_WINDOW_MS + 1)]),
    );
    expect(outside).toHaveLength(0);
  });

  test('same-timestamp nodes are never linked (no cycles)', () => {
    const edges = buildEdges(buildNodes([row(1, 'ERROR a', T0, 1), row(2, 'ERROR b', T0, 1)]));
    expect(edges).toEqual([]);
  });

  test('picks highest confidence, then the most recent candidate on ties', () => {
    // log-1 same execution (0.5); log-2 different execution (0.15); log-3 same execution (0.5, newer)
    const nodes = buildNodes([
      row(1, 'ERROR a', T0, 1),
      row(2, 'ERROR b', T0 + 1000, 2),
      row(3, 'ERROR c', T0 + 2000, 1),
      row(4, 'ERROR d', T0 + 3000, 1),
    ]);
    const edge = buildEdges(nodes).find((e) => e.childId === 'log-4');
    expect(edge?.parentId).toBe('log-3');
  });

  test('every child has at most one parent', () => {
    const nodes = buildNodes(
      Array.from({ length: 20 }, (_, i) => row(i + 1, `ERROR e${i}`, T0 + i * 1000)),
    );
    const children = buildEdges(nodes).map((e) => e.childId);
    expect(new Set(children).size).toBe(children.length);
  });
});

describe('buildClusters', () => {
  test('groups recurring events by template', () => {
    const nodes = buildNodes([
      row(1, 'ERROR timeout after 30s', T0),
      row(2, 'ERROR timeout after 45s', T0 + 1000),
      row(3, 'WARN other', T0 + 2000),
    ]);
    const clusters = buildClusters(nodes);
    expect(clusters[0].count).toBe(2);
    expect(clusters).toHaveLength(2);
  });
});

/**
 * postmortem-validator unit tests
 *
 * Golden replay of the fixture chains, live-edge confirmation, DecisionLog
 * keyword matching, and the null match rate when there is nothing to check.
 */
import { describe, test, expect } from 'bun:test';
import { validateLineage } from '../postmortem-validator';
import { KNOWN_CHAINS, type KnownChain } from '../known-chains.fixture';
import { buildEdges, buildNodes } from '../lineage-builder';

const T0 = Date.UTC(2026, 9, 15);

describe('validateLineage', () => {
  test('all fixture edges are reproduced by the estimator', () => {
    const v = validateLineage([], [], []);
    const expected = KNOWN_CHAINS.reduce(
      (s, c) => s + c.events.filter((e) => e.parent !== null).length,
      0,
    );
    expect(v.knownEdgeCount).toBe(expected);
    expect(v.matched).toBe(expected);
    expect(v.mismatched).toBe(0);
    expect(v.matchRate).toBe(1);
  });

  test('matchRate is null when no chains are given (no division by zero)', () => {
    const v = validateLineage([], [], [], []);
    expect(v.matchRate).toBeNull();
    expect(v.knownEdgeCount).toBe(0);
  });

  test('an expected edge the estimator cannot reproduce counts as mismatched', () => {
    const bad: KnownChain = {
      id: 'bad',
      label: 'bad',
      keywords: [],
      events: [
        { text: 'ERROR first', offsetSec: 0, parent: null },
        { text: 'ERROR second', offsetSec: 10, parent: null },
        // expected parent is event 0, but the estimator picks the newer event 1
        { text: 'ERROR third', offsetSec: 20, parent: 0 },
      ],
    };
    const v = validateLineage([], [], [], [bad]);
    expect(v.knownEdgeCount).toBe(1);
    expect(v.mismatched).toBe(1);
    expect(v.matchRate).toBe(0);
  });

  test('live edges matching a known template pair are confirmed, others unchecked', () => {
    const nodes = buildNodes([
      {
        id: 1,
        executionId: 9,
        logChunk: 'ERROR merge conflict in feature/zzz-9 while rebasing',
        logType: 'stdout',
        sequenceNumber: 1,
        timestamp: T0,
      },
      {
        id: 2,
        executionId: 9,
        logChunk: 'ERROR git push rejected for feature/zzz-9 (non-fast-forward)',
        logType: 'stdout',
        sequenceNumber: 2,
        timestamp: T0 + 5000,
      },
      {
        id: 3,
        executionId: 9,
        logChunk: 'WARN unrelated thing',
        logType: 'stdout',
        sequenceNumber: 3,
        timestamp: T0 + 9000,
      },
    ]);
    const edges = buildEdges(nodes);
    const v = validateLineage(nodes, edges, []);
    expect(v.liveConfirmed).toBe(1);
    expect(v.unchecked).toBe(1);
  });

  test('counts DecisionLog texts mentioning known-chain keywords', () => {
    const v = validateLineage(
      [],
      [],
      ['push rejected を調査した', '関係ない決定', 'Merge CONFLICT postmortem'],
    );
    expect(v.decisionLogMatches).toBe(2);
  });
});

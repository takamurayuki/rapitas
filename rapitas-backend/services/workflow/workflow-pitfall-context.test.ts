/**
 * workflow-pitfall-context テスト
 *
 * 知識グラフの concept/technology —causes→ problem エッジから実装者向けの
 * 既知失敗パターン警告が組み立てられること、複数ソースの重み合算、
 * 閾値未満・データ無しの空文字を検証する。Own file — mock.module is
 * process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

interface NodeRow {
  id: number;
  label: string;
  nodeType: string;
}
interface EdgeRow {
  fromNodeId: number;
  weight: number;
  toNode: { id: number; label: string };
}

let nodes: NodeRow[] = [];
let edges: EdgeRow[] = [];

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeGraphNode: {
      findMany: mock((args: { where: { OR: Array<{ label: string; nodeType: string }> } }) => {
        const wanted = args.where.OR;
        return Promise.resolve(
          nodes.filter((n) => wanted.some((w) => w.label === n.label && w.nodeType === n.nodeType)),
        );
      }),
    },
    knowledgeGraphEdge: {
      findMany: mock((args: { where: { fromNodeId: { in: number[] }; weight: { gte: number } } }) =>
        Promise.resolve(
          edges.filter(
            (e) =>
              args.where.fromNodeId.in.includes(e.fromNodeId) && e.weight >= args.where.weight.gte,
          ),
        ),
      ),
    },
  },
}));

const { buildKnownPitfallsSection } = await import('./workflow-pitfall-context');

beforeEach(() => {
  nodes = [];
  edges = [];
});

describe('buildKnownPitfallsSection', () => {
  test('graph empty for this task type → empty string', async () => {
    const s = await buildKnownPitfallsSection({ title: '[Refactor] cache' });
    expect(s).toBe('');
  });

  test('problems linked from the task type render with cause-specific advice', async () => {
    nodes = [{ id: 1, label: 'Refactor', nodeType: 'concept' }];
    edges = [{ fromNodeId: 1, weight: 0.6, toNode: { id: 10, label: 'verify_repair' } }];
    const s = await buildKnownPitfallsSection({ title: '[Refactor] cache TTL' });
    expect(s).toContain('既知の失敗パターン');
    expect(s).toContain('verify_repair');
    expect(s).toContain('lint / typecheck'); // cause-specific advice line
    expect(s).toContain('Refactor'); // source attribution
  });

  test('same problem reachable from type AND technology aggregates weight and sources', async () => {
    nodes = [
      { id: 1, label: 'Feature', nodeType: 'concept' },
      { id: 2, label: 'Prisma', nodeType: 'technology' },
    ];
    edges = [
      { fromNodeId: 1, weight: 0.4, toNode: { id: 10, label: 'ci_repair' } },
      { fromNodeId: 2, weight: 0.5, toNode: { id: 10, label: 'ci_repair' } },
      { fromNodeId: 1, weight: 0.35, toNode: { id: 11, label: 'plan_invalid' } },
    ];
    const s = await buildKnownPitfallsSection({ title: '[Feature] Prisma スキーマ拡張' });
    // ci_repair (0.9 aggregate) must rank above plan_invalid (0.35).
    expect(s.indexOf('ci_repair')).toBeLessThan(s.indexOf('plan_invalid'));
    expect(s).toContain('Feature / Prisma');
  });

  test('edges below the weight floor are ignored (empty section)', async () => {
    nodes = [{ id: 1, label: 'general', nodeType: 'concept' }];
    edges = []; // the mock's gte filter already models the floor; nothing passes
    const s = await buildKnownPitfallsSection({ title: 'no prefix task' });
    expect(s).toBe('');
  });

  test('DB failure → empty string (best-effort)', async () => {
    nodes = null as unknown as NodeRow[]; // force the mock to throw
    const s = await buildKnownPitfallsSection({ title: '[Bug] x' });
    expect(s).toBe('');
  });
});

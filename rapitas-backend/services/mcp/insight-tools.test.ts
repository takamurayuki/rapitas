/**
 * insight-tools tests
 *
 * The P1/P2 MCP tools from #1318: the hypothesis ledger (read + record), the
 * quality metrics, decision calibration, knowledge-graph neighbours and the
 * stored PR risk score. Dependencies are injected, so these pin the argument
 * handling and what each tool reports, not the services behind them.
 */
import { describe, test, expect, mock } from 'bun:test';
import { INSIGHT_TOOL_DEFINITIONS, executeInsightTool, type InsightDeps } from './insight-tools';

function deps(over: Partial<InsightDeps> = {}): InsightDeps {
  return {
    listHypotheses: mock(async () => ({ hypotheses: [], total: 0 })),
    submitHypothesis: mock(async () => ({ ok: true, id: 7 })),
    growthLedger: mock(async () => ({ windowDays: 7, windows: [] })),
    decisionStats: mock(async () => ({ byDecider: {}, recentReviewed: [] })),
    findRelated: mock(async () => ({ nodes: [], edges: [] })),
    latestPrRisk: mock(async () => null),
    ...over,
  };
}
const text = (r: { content: { text: string }[] } | null) => r?.content[0].text ?? '';

describe('definitions', () => {
  test('every listed tool is handled by this module', async () => {
    for (const d of INSIGHT_TOOL_DEFINITIONS) {
      expect(await executeInsightTool(d.name, {}, deps())).not.toBeNull();
    }
  });
  test('names it does not own return null', async () => {
    expect(await executeInsightTool('rapitas_list_tasks', {}, deps())).toBeNull();
  });
});

describe('rapitas_list_hypotheses', () => {
  test('supported/refuted span every forgetting stage (#1321), open stays active-only', async () => {
    const d = deps();
    await executeInsightTool('rapitas_list_hypotheses', { status: 'supported' }, d);
    await executeInsightTool('rapitas_list_hypotheses', { status: 'open' }, d);
    const calls = (d.listHypotheses as ReturnType<typeof mock>).mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ status: 'supported', stages: 'all' });
    expect(calls[1]).toMatchObject({ status: 'open' });
    expect(calls[1].stages).toBeUndefined();
  });

  test('caps limit at 50 and rejects a malformed one instead of coercing it', async () => {
    const d = deps();
    await executeInsightTool('rapitas_list_hypotheses', { limit: '500' }, d);
    expect((d.listHypotheses as ReturnType<typeof mock>).mock.calls[0][0].limit).toBe(50);
    const bad = await executeInsightTool('rapitas_list_hypotheses', { limit: '5abc' }, d);
    expect(bad?.isError).toBe(true);
  });

  test('rejects an unknown status', async () => {
    const r = await executeInsightTool('rapitas_list_hypotheses', { status: 'maybe' }, deps());
    expect(r?.isError).toBe(true);
  });
});

describe('rapitas_record_hypothesis', () => {
  test('files with source "mcp" and reports the id', async () => {
    const d = deps();
    const r = await executeInsightTool(
      'rapitas_record_hypothesis',
      { statement: 'Caching the role lookup halves cold-start time', rationale: 'measured 2x' },
      d,
    );
    expect((d.submitHypothesis as ReturnType<typeof mock>).mock.calls[0][0]).toMatchObject({
      source: 'mcp',
    });
    expect(text(r)).toContain('#7');
  });

  test('a falsifiability rejection is an error that says why', async () => {
    const d = deps({ submitHypothesis: mock(async () => ({ ok: false, reason: 'too vague' })) });
    const r = await executeInsightTool(
      'rapitas_record_hypothesis',
      { statement: 'x', rationale: 'y' },
      d,
    );
    expect(r?.isError).toBe(true);
    expect(text(r)).toContain('too vague');
  });

  test('statement and rationale are required', async () => {
    const r = await executeInsightTool('rapitas_record_hypothesis', { statement: 's' }, deps());
    expect(r?.isError).toBe(true);
  });
});

describe('rapitas_get_quality_metrics', () => {
  test('returns the newest windows only, as many as asked (default 4, max 12)', async () => {
    const windows = Array.from({ length: 12 }, (_, i) => ({ from: `w${i}` }));
    const d = deps({ growthLedger: mock(async () => ({ windowDays: 7, windows })) as never });
    const r = await executeInsightTool('rapitas_get_quality_metrics', {}, d);
    expect(JSON.parse(text(r)).windows.map((w: { from: string }) => w.from)).toEqual([
      'w0',
      'w1',
      'w2',
      'w3',
    ]);
  });
});

describe('rapitas_find_related_knowledge', () => {
  test('requires a positive node id', async () => {
    const r = await executeInsightTool('rapitas_find_related_knowledge', { nodeId: '-3' }, deps());
    expect(r?.isError).toBe(true);
  });
  test('passes the node id through', async () => {
    const d = deps();
    await executeInsightTool('rapitas_find_related_knowledge', { nodeId: '12' }, d);
    expect((d.findRelated as ReturnType<typeof mock>).mock.calls[0][0]).toBe(12);
  });
});

describe('rapitas_get_pr_risk', () => {
  test('says plainly when no score is stored', async () => {
    const r = await executeInsightTool(
      'rapitas_get_pr_risk',
      { repo: 'o/r', prNumber: '5' },
      deps(),
    );
    expect(r?.isError).toBeFalsy();
    expect(text(r)).toContain('No risk score');
  });
  test('rejects a repo that is not owner/name', async () => {
    const r = await executeInsightTool(
      'rapitas_get_pr_risk',
      { repo: 'nope', prNumber: '5' },
      deps(),
    );
    expect(r?.isError).toBe(true);
  });
});

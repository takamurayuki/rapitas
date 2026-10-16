/**
 * deviation-handlers tests — timeline, log context and audit endpoints with
 * injected dependencies (no DB).
 */
import { describe, expect, mock, test } from 'bun:test';
import {
  handleGetDeviationTimeline,
  handleGetDeviationContext,
  handlePostDeviationAudit,
  recordApprovalDeviationAudit,
  type DeviationDeps,
  type ExecutionInfo,
} from './deviation-handlers';
import type {
  DeviationAuditRecord,
  OperationRecord,
} from '../../../services/workflow/plan-deviation';

const SECRET = 'sk-' + 'Hh1Ii2Jj3Kk4Ll5Mm6Nn7Oo8';
const PLAN =
  '```json:plan-declaration\n{"version":1,"files":["src/**"],"commands":["bun"],"externalHosts":[]}\n```';

const OPS: OperationRecord[] = [
  {
    seq: 1,
    occurredAt: '2026-10-13T00:00:01.000Z',
    kind: 'command',
    tool: 'Bash',
    features: { commandNames: ['rm'] },
    displayMasked: 'Bash: rm -rf [REDACTED]',
    logSequence: 3,
  },
];

function makeDeps(overrides: Partial<DeviationDeps> = {}) {
  const audits: DeviationAuditRecord[] = [];
  const execution: ExecutionInfo = {
    id: 9,
    status: 'completed',
    agentType: null,
    worktreePath: null,
  };
  const deps: DeviationDeps = {
    readPlan: async () => PLAN,
    findExecutions: async () => [execution],
    readOperations: (id) => ({ operations: id === 9 ? OPS : [], warnings: [] }),
    logSource: () => ({
      getBounds: async () => ({ min: 0, max: 6 }),
      getRange: async (from, to) =>
        Array.from({ length: to - from + 1 }, (_, i) => ({
          sequenceNumber: from + i,
          logChunk: from + i === 3 ? `curl -H "Bearer ${SECRET}"` : `line ${from + i}`,
        })),
    }),
    appendAudit: (r) => {
      audits.push(r);
    },
    ...overrides,
  };
  return { deps, audits };
}

const set = () => ({ status: 200 });

describe('GET deviation-timeline', () => {
  test('returns classified entries for the latest execution with operations', async () => {
    const { deps } = makeDeps();
    const s = set();
    const r = await handleGetDeviationTimeline(
      { params: { taskId: '5' }, query: {}, set: s },
      deps,
    );
    expect(s.status).toBe(200);
    expect(r).toMatchObject({ status: 'ok', executionId: 9 });
    if (!('entries' in r)) throw new Error('unexpected');
    expect(r.entries.map((e) => e.category)).toEqual([
      'out_of_plan',
      'planned_not_executed',
      'planned_not_executed',
    ]);
  });

  test('ambiguous plan → warning and no entries', async () => {
    const { deps } = makeDeps({ readPlan: async () => '# no files' });
    const r = await handleGetDeviationTimeline(
      { params: { taskId: '5' }, query: {}, set: set() },
      deps,
    );
    expect(r).toMatchObject({ status: 'ambiguous', entries: [], counts: null });
  });

  test('codex execution → unsupported_provider', async () => {
    const { deps } = makeDeps({
      findExecutions: async () => [
        { id: 9, status: 'completed', agentType: 'codex', worktreePath: null },
      ],
    });
    const r = await handleGetDeviationTimeline(
      { params: { taskId: '5' }, query: { executionId: '9' }, set: set() },
      deps,
    );
    expect(r).toMatchObject({ status: 'unsupported_provider' });
  });

  test('invalid taskId → 400', async () => {
    const s = set();
    await handleGetDeviationTimeline(
      { params: { taskId: 'x' }, query: {}, set: s },
      makeDeps().deps,
    );
    expect(s.status).toBe(400);
  });
});

describe('GET deviation-context', () => {
  test('returns masked lines around seq', async () => {
    const { deps } = makeDeps();
    const r = await handleGetDeviationContext(
      { params: { executionId: '9' }, query: { seq: '3', before: '1', after: '1' }, set: set() },
      deps,
    );
    expect(JSON.stringify(r)).not.toContain(SECRET);
    if (!('lines' in r)) throw new Error('unexpected');
    expect(r.lines.map((l) => l.sequenceNumber)).toEqual([2, 3, 4]);
    expect(r.lines[1].isTarget).toBe(true);
  });

  test('missing seq → 400', async () => {
    const s = set();
    await handleGetDeviationContext(
      { params: { executionId: '9' }, query: {}, set: s },
      makeDeps().deps,
    );
    expect(s.status).toBe(400);
  });
});

describe('POST deviation-audit', () => {
  test('requires X-Rapitas-Source ui|operator (403 otherwise)', async () => {
    const { deps, audits } = makeDeps();
    const s = set();
    const r = await handlePostDeviationAudit(
      { params: { taskId: '5' }, body: { decision: 'approved' }, headers: {}, set: s },
      deps,
    );
    expect(s.status).toBe(403);
    expect(r).toMatchObject({ success: false });
    expect(audits).toHaveLength(0);
  });

  test('saves counts, kinds and masked comment', async () => {
    const { deps, audits } = makeDeps();
    const r = await handlePostDeviationAudit(
      {
        params: { taskId: '5' },
        body: { decision: 'approved', comment: `ok ${SECRET}` },
        headers: { 'x-rapitas-source': 'ui' },
        set: set(),
      },
      deps,
    );
    expect(r).toMatchObject({ success: true });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      taskId: 5,
      executionId: 9,
      decision: 'approved',
      counts: { inPlan: 0, outOfPlan: 1, plannedNotExecuted: 2 },
      byKind: { file_change: 1, command: 2, http: 0 },
      source: 'ui',
    });
    expect(audits[0].commentMasked).not.toContain(SECRET);
  });

  test('invalid decision → 400', async () => {
    const s = set();
    await handlePostDeviationAudit(
      {
        params: { taskId: '5' },
        body: { decision: 'maybe' },
        headers: { 'x-rapitas-source': 'ui' },
        set: s,
      },
      makeDeps().deps,
    );
    expect(s.status).toBe(400);
  });
});

describe('recordApprovalDeviationAudit', () => {
  test('returns saved:true with the record', async () => {
    const { deps, audits } = makeDeps();
    const r = await recordApprovalDeviationAudit(
      { taskId: 5, decision: 'approved', comment: 'fine', source: 'operator' },
      deps,
    );
    expect(r.saved).toBe(true);
    expect(audits).toHaveLength(1);
  });

  test('never throws: a write failure becomes saved:false', async () => {
    const { deps } = makeDeps({
      appendAudit: mock(() => {
        throw new Error('EROFS');
      }),
    });
    const r = await recordApprovalDeviationAudit(
      { taskId: 5, decision: 'approved', source: 'ui' },
      deps,
    );
    expect(r).toEqual({ saved: false, error: 'EROFS' });
  });
});

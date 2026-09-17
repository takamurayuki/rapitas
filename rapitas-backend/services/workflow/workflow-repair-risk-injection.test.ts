/**
 * workflow-repair-risk-injection tests
 *
 * Wiring of the repair-risk tactic block into all four role contexts
 * (researcher / planner / implementer / verifier + auto_verifier): the block is
 * injected when high-risk, absent otherwise, measured by recordContextMetrics,
 * and requested with the right stream. Same hermetic mock set as
 * workflow-context-builder.test (process-global mocks — run in isolation).
 */
import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';

class OpenSubtasksError extends Error {}
mock.module('./workflow-file-utils', () => ({
  readWorkflowFile: mock(() => Promise.resolve(null)),
  writeWorkflowFile: mock((_t: number, _f: string, content: string) => Promise.resolve(content)),
  archiveWorkflowFile: mock(() => Promise.resolve(false)),
  resolveWorkflowDir: mock(() => Promise.resolve(null)),
  cleanupRootWorkflowFiles: mock(() => Promise.resolve()),
  looksLikeAgentLog: mock(() => false),
  sliceFromReportHeading: mock((text: string) => text),
  extractMarkdownFromOutput: mock((output: string) => output),
  OpenSubtasksError,
}));

const ORIGINAL_CRITIC_LESSONS = process.env.RAPITAS_CRITIC_LESSONS;
process.env.RAPITAS_CRITIC_LESSONS = '0';
afterAll(() => {
  if (ORIGINAL_CRITIC_LESSONS === undefined) delete process.env.RAPITAS_CRITIC_LESSONS;
  else process.env.RAPITAS_CRITIC_LESSONS = ORIGINAL_CRITIC_LESSONS;
});

const recordContextMetricsSpy = mock((..._args: unknown[]) => Promise.resolve());
mock.module('./workflow-context-metrics', () => ({
  recordContextMetrics: recordContextMetricsSpy,
  computeSectionMetrics: mock(() => ({ sections: [], totalChars: 0, totalEstTokens: 0 })),
  estimateTokens: mock(() => 0),
}));

mock.module('./workflow-memory-context', () => ({
  buildMemoryContext: mock(() => Promise.resolve('')),
  applyOutcomeWeighting: mock((entries: unknown[]) => entries),
  renderMemorySection: mock(() => ''),
  TEXT: { ja: {}, en: {} },
}));

const TACTIC_MARKER = '## 差し戻し高リスク判定（テスト）';
let tacticOutput = '';
const tacticSpy = mock((_taskId: number, _task: unknown, stream: string, _lang: string) =>
  Promise.resolve(tacticOutput ? `${tacticOutput} [${stream}]` : ''),
);
mock.module('./learning/repair-risk-tactic-section', () => ({
  buildRepairRiskTacticSection: tacticSpy,
  renderRepairRiskTacticSection: mock(() => ''),
  recordRepairRiskPrediction: mock(() => Promise.resolve()),
  selectTactics: mock(() => []),
}));

function benignPrismaResult(method: string): unknown {
  if (method === 'findMany' || method === 'groupBy') return [];
  if (method === 'count') return 0;
  if (method === 'updateMany' || method === 'deleteMany') return { count: 0 };
  return null;
}
const mockPrisma = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        { get: (_t, method: string) => mock(() => Promise.resolve(benignPrismaResult(method))) },
      ),
  },
);
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: mock(() => Promise.resolve()),
}));

const { buildRoleContext } = await import('./workflow-context-builder');

const TASK = { title: 'Test task', description: 'A test description' };
type Role = Parameters<typeof buildRoleContext>[1];
const CASES: Array<[Role, string]> = [
  ['researcher', 'research'],
  ['planner', 'plan'],
  ['implementer', 'implement'],
  ['verifier', 'verify'],
  ['auto_verifier', 'verify'],
];

function recordedSections(): Record<string, unknown> {
  const call = recordContextMetricsSpy.mock.calls[0]!;
  return call[3] as Record<string, unknown>;
}

describe('repair-risk tactic injection', () => {
  beforeEach(() => {
    recordContextMetricsSpy.mockClear();
    tacticSpy.mockClear();
    tacticOutput = '';
  });

  test.each(CASES)(
    '%s: 高リスク時は戦術ブロックが本文に入り計測対象にも含まれる',
    async (role, stream) => {
      tacticOutput = TACTIC_MARKER;
      const ctx = await buildRoleContext(1, role, TASK);
      expect(ctx).toContain(`${TACTIC_MARKER} [${stream}]`);
      expect(tacticSpy).toHaveBeenCalledTimes(1);
      expect(tacticSpy.mock.calls[0]![2]).toBe(stream);
      expect(recordContextMetricsSpy).toHaveBeenCalledTimes(1);
      const sections = recordedSections();
      expect(Object.keys(sections)).toContain('repairRisk');
      expect(String(sections.repairRisk)).toContain(TACTIC_MARKER);
    },
  );

  test.each(CASES)('%s: 非高リスク時はブロックを出さない', async (role) => {
    const ctx = await buildRoleContext(1, role, TASK);
    expect(ctx).not.toContain(TACTIC_MARKER);
    expect(ctx).not.toContain('\n\n\n\n');
    expect(Object.keys(recordedSections())).toContain('repairRisk');
  });
});

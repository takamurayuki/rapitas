/**
 * prompt-band-evidence backtest
 *
 * Validates task #970's受入基準: compares the SUCCESS RATE of the current
 * "apply the latest approved version to every task, regardless of difficulty
 * band" behavior against the band-aware recommendation
 * (recommendPromptVersion) on the SAME past-outcome fixture. The REAL
 * computeBandEvidence aggregation runs against an in-memory Prisma fake — only
 * the DB layer is faked, so the windowing / banding / dedupe logic is under
 * test. Per plan.md's 受入基準の比較対象, a passing backtest means either an
 * improvement over the naive baseline, or an honest insufficient_data.
 * Own file — mock.module is process-global (separate from the regular unit tests).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));

interface EvoRow {
  id: number;
  afterPrompt: string;
  evidenceJson: string | null;
  createdAt: Date;
}
interface PastTask {
  id: number;
  complexityScore: number;
  executedAt: Date;
  /** Whether a verify/ci repair transition was recorded for this task. */
  repaired: boolean;
}

let evoRows: EvoRow[] = [];
let pastTasks: PastTask[] = [];

type Window = { gte?: Date; lt?: Date } | undefined;
const inWindow = (d: Date, w: Window) => (!w?.gte || d >= w.gte) && (!w?.lt || d < w.lt);

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: {
    promptEvolution: { findMany: () => Promise.resolve(evoRows) },
    agentExecution: {
      findMany: (args: { where: { createdAt?: Window } }) =>
        Promise.resolve(
          pastTasks
            .filter((t) => inWindow(t.executedAt, args.where.createdAt))
            .map((t) => ({
              executionTimeMs: 1000,
              inputTokens: 100,
              session: { config: { taskId: t.id } },
            })),
        ),
    },
    task: {
      findMany: (args: { where: { id: { in: number[] } } }) =>
        Promise.resolve(
          pastTasks
            .filter((t) => args.where.id.in.includes(t.id))
            .map((t) => ({ id: t.id, complexityScore: t.complexityScore })),
        ),
    },
    workflowTransition: {
      findMany: (args: { where: { taskId: { in: number[] }; createdAt?: Window } }) =>
        Promise.resolve(
          pastTasks
            .filter(
              (t) =>
                t.repaired &&
                args.where.taskId.in.includes(t.id) &&
                inWindow(t.executedAt, args.where.createdAt),
            )
            .map((t) => ({ taskId: t.id })),
        ),
    },
    workflowFile: { findMany: () => Promise.resolve([]) },
  },
}));

const { recommendPromptVersion, resolvePromptVersionHistory } =
  await import('./prompt-version-history');
const { _resetBandEvidenceCache } = await import('./prompt-band-evidence');

const V1_START = '2026-01-01T00:00:00Z';
const V2_START = '2026-02-01T00:00:00Z';
const MODEL = 'claude-sonnet-5';

function row(id: number, approvedAt: string): EvoRow {
  return {
    id,
    afterPrompt: `addendum-${id}`,
    evidenceJson: JSON.stringify({ approvedAt }),
    createdAt: new Date(approvedAt),
  };
}

let nextTaskId = 1;
/** Adds `total` tasks in one (band, version) cell, the first `repaired` of which needed a repair. */
function addCell(score: number, executedAt: string, total: number, repaired: number): PastTask[] {
  const added = Array.from({ length: total }, (_, i) => ({
    id: nextTaskId++,
    complexityScore: score,
    executedAt: new Date(executedAt),
    repaired: i < repaired,
  }));
  pastTasks.push(...added);
  return added;
}

const successRateOf = (tasks: PastTask[]): number =>
  tasks.filter((t) => !t.repaired).length / tasks.length;

beforeEach(() => {
  evoRows = [];
  pastTasks = [];
  nextTaskId = 1;
  _resetBandEvidenceCache();
});

describe('band-aware recommendation vs naive latest-version-for-everyone baseline', () => {
  test('sufficient sample: recommended success rate beats the latest-version baseline in the band it matters', async () => {
    evoRows = [row(1, V1_START), row(2, V2_START)];
    // standard band: the older v1 works better (90%) than the latest v2 (60%).
    addCell(50, '2026-01-10T00:00:00Z', 20, 2);
    const v2Standard = addCell(50, '2026-02-10T00:00:00Z', 15, 6);
    // light band: the latest v2 is better (100%) than v1 (50%).
    addCell(10, '2026-01-10T00:00:00Z', 10, 5);
    addCell(10, '2026-02-10T00:00:00Z', 10, 0);

    const history = await resolvePromptVersionHistory('implementer');
    const naiveLatest = history[history.length - 1];
    expect(naiveLatest.versionId).toBe(2);
    const naiveStandardRate = successRateOf(v2Standard);

    const standard = await recommendPromptVersion('implementer', MODEL, 50);
    expect(standard.explorationMode).toBe(false);
    expect(standard.recommendedVersionId).toBe(1);
    expect(standard.successRate).toBeCloseTo(0.9, 5);
    expect(standard.successRate as number).toBeGreaterThan(naiveStandardRate);
    expect(standard.sampleSize).toBe(20);

    // The recommendation is genuinely band-aware: light picks the other version.
    const light = await recommendPromptVersion('implementer', MODEL, 10);
    expect(light.explorationMode).toBe(false);
    expect(light.recommendedVersionId).toBe(2);
    expect(light.successRate).toBeCloseTo(1, 5);
  });

  test('every version cell only counts executions and repairs inside its own window', async () => {
    evoRows = [row(1, V1_START), row(2, V2_START)];
    addCell(50, '2026-01-10T00:00:00Z', 10, 10); // v1: every task repaired in January
    addCell(50, '2026-02-10T00:00:00Z', 10, 0); // v2: none repaired

    const rec = await recommendPromptVersion('implementer', MODEL, 50);
    expect(rec.recommendedVersionId).toBe(2);
    expect(rec.successRate).toBeCloseTo(1, 5);
  });

  test('insufficient sample: reports exploration honestly instead of a fabricated improvement', async () => {
    evoRows = [row(1, V1_START)];
    addCell(50, '2026-01-10T00:00:00Z', 2, 0);

    const recommendation = await recommendPromptVersion('implementer', MODEL, 50);
    expect(recommendation.explorationMode).toBe(true);
    expect(recommendation.sampleSize).toBe(2);
  });

  test('tasks from another difficulty band never leak into the queried band', async () => {
    evoRows = [row(1, V1_START)];
    addCell(90, '2026-01-10T00:00:00Z', 20, 0); // comprehensive only

    const rec = await recommendPromptVersion('implementer', MODEL, 50);
    expect(rec.explorationMode).toBe(true);
    expect(rec.sampleSize).toBe(0);
  });
});

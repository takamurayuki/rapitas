/**
 * jury-review-run.test-helpers
 *
 * Test-only stand-in for jury-review-run.ts, for the jury-gate unit tests that mock the database away. The lock itself
 * (create run → take Task.juryRunId → read identifiers → re-check → release)
 * is exercised against a real SQLite database in jury-review-run.test.ts and
 * criteria-jury-lock.acceptance.test.ts; here the gates only need a run that
 * is either granted, busy, or found drifted.
 *
 * NOTE: mock.module replaces the WHOLE module, so every export of the real
 * modules is mirrored here (CLAUDE.md §3) — a missing one silently drops the
 * mocking test file's tests.
 */
import type { JuryRunHandle, JuryRunSeen } from './jury-review-run';
import { revisionOfLists } from '../task/task-criteria-revision';

/**
 * The revision of a task with no criteria — what readCriteriaRevision computes
 * from the gate tests' mocked task rows, which carry no criteria columns.
 */
export const EMPTY_CRITERIA_REVISION = revisionOfLists({
  goals: [],
  constraints: [],
  acceptanceCriteria: [],
});

/** Per-test behaviour of the fake lock. */
export interface FakeJuryRunState {
  /** false = another run holds the lock (busy_skipped). */
  acquire: boolean;
  /** false = the pre-apply re-check finds drift (verdict discarded). */
  stillBound: boolean;
  /** The criteria revision the run (and readCriteriaRevision) reports. */
  criteriaRevision: string | null;
  /** verify.md sha256 the run reports; null = read via the caller's mocks is not simulated. */
  verifySha256: () => string | null;
  /** Closed runs, in order. */
  finished: Array<{ status: string } & JuryRunSeen>;
  discarded: number;
}

/**
 * A fresh state: lock granted, nothing drifts.
 *
 * @param verifySha256 - Supplier of the verify.md sha the run records / 記録する verify.md の sha
 * @returns State / 状態
 */
export function fakeJuryRunState(verifySha256: () => string | null): FakeJuryRunState {
  return {
    acquire: true,
    stillBound: true,
    criteriaRevision: EMPTY_CRITERIA_REVISION,
    verifySha256,
    finished: [],
    discarded: 0,
  };
}

/**
 * The module object to hand to mock.module('…/jury-review-run').
 *
 * @param s - Shared state / 共有状態
 * @returns Module exports / モジュールの export
 */
export function fakeJuryRunModule(s: FakeJuryRunState) {
  let nextId = 1;
  const run = (taskId: number, source: JuryRunHandle['source']): JuryRunHandle => ({
    id: nextId++,
    taskId,
    source,
    verifySha256: s.verifySha256(),
    criteriaRevision: s.criteriaRevision,
  });
  return {
    JURY_RUN_HEARTBEAT_MS: 15_000,
    JURY_RUN_STALE_MS: 90_000,
    JURY_RESULT_DISCARDED_CAUSE: 'jury_result_discarded',
    JURY_RESULT_DISCARDED_RESUME: 'test',
    JURY_RESULT_DISCARDED_HALT_REASON: 'jury_result_discarded',
    liveJuryRunIds: () => [] as number[],
    beginJuryRun: async (p: { taskId: number; source: JuryRunHandle['source'] }) =>
      s.acquire
        ? { acquired: true as const, run: run(p.taskId, p.source) }
        : { acquired: false as const, runId: 0 },
    juryRunDrift: async () => [],
    withJuryRun: async <T>(
      p: { taskId: number; source: JuryRunHandle['source'] },
      body: (r: JuryRunHandle) => Promise<{ result: T; seen: JuryRunSeen }>,
      onBusy: () => T | Promise<T>,
    ): Promise<T> => {
      if (!s.acquire) return onBusy();
      const { result, seen } = await body(run(p.taskId, p.source));
      s.finished.push({ status: 'applied', ...seen });
      return result;
    },
    confirmJuryRunStillBound: async () => {
      if (!s.stillBound) s.discarded++;
      return s.stillBound;
    },
    finishJuryRun: async (_r: unknown, end: { status: string } & JuryRunSeen) => {
      s.finished.push(end);
    },
    discardStaleJuryResult: async () => {
      s.discarded++;
    },
  };
}

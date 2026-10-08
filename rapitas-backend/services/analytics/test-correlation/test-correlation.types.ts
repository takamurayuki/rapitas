/**
 * test-correlation.types
 *
 * Shared types for the test-failure correlation heatmap: run history records,
 * correlation matrix cells, confidence levels, and failure drilldown entries.
 * Contains no logic — pure type definitions consumed by the store, engine,
 * PR-risk scorer, notifier, and HTTP route layer.
 */

/** Where a test run originated. 'manual' is populated via POST /analytics/test-correlation/manual-run. */
export type RunSource = 'ci' | 'local' | 'manual';

/** Pass/fail/skip status of a single test file within a run. */
export type TestRunStatus = 'pass' | 'fail' | 'skip';

/** Per-file result recorded for one run. */
export interface TestResultEntry {
  /** Path relative to the backend root, e.g. "services/foo/bar.test.ts". */
  file: string;
  status: TestRunStatus;
}

/**
 * One completed test run's summary — the unit persisted by run-history-store.
 * Stores summary fields plus a bounded tail of failing-file output (failureTail)
 * so drilldown can show why a test failed without retaining full logs.
 */
export interface RunRecord {
  /** Unique identifier for this run (e.g. crypto.randomUUID()). */
  runId: string;
  /** ISO timestamp of when the run completed. */
  timestamp: string;
  source: RunSource;
  /** Git commit SHA at the time of the run, or null when unavailable. */
  commitSha: string | null;
  /** Files changed relative to the diff base, relative to repo root. */
  changedFiles: string[];
  testResults: TestResultEntry[];
  environment: {
    platform: string;
    runtimeVersion: string;
  };
  /** Truncated output tail keyed by failing test file. Absent for runs recorded before failure logs were stored. */
  failureTail?: Record<string, string[]>;
}

/** Top-level JSON structure persisted by run-history-store. */
export interface RunHistoryFile {
  version: 1;
  runs: RunRecord[];
}

/** Confidence label for a correlation cell — driven by sample size and significance. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** One cell of the changed-file × test-file correlation matrix. */
export interface CorrelationCell {
  changedFile: string;
  testFile: string;
  /** Pearson correlation coefficient, or null when sampleSize < 2. */
  correlation: number | null;
  /** Two-tailed p-value from the t-distribution approximation, or null when correlation is null. */
  pValue: number | null;
  /** Number of runs where changedFile appeared, used as the correlation sample size. */
  sampleSize: number;
  confidence: ConfidenceLevel;
  /** True when this test file has an existing flaky-history entry (services/analytics's retry-policy). */
  nonDeterministic: boolean;
}

/** One failure event surfaced by the drilldown API for a given cell. */
export interface FailureDrilldownEntry {
  runId: string;
  timestamp: string;
  commitSha: string | null;
  source: RunSource;
  environment: RunRecord['environment'];
  flaky: boolean;
  /** Truncated failing-file output for this run, when it was recorded. */
  failureTail?: string[];
}

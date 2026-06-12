/**
 * actions.types.ts
 *
 * Shared types for the CI/CD (GitHub Actions) view: workflow runs, their jobs,
 * and per-job steps. Mirrors the backend `gh run` API response shape.
 */

/** A workflow run as returned by the run-list endpoint. */
export interface WorkflowRun {
  databaseId: number;
  number: number;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  workflowName: string;
  headBranch: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/** A single step within a job. */
export interface RunStep {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
}

/** A job within a run, including its steps. */
export interface RunJob {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps: RunStep[];
}

/** A run with its jobs/steps (detail view). */
export interface RunDetail extends WorkflowRun {
  jobs: RunJob[];
}

/** A step's log section parsed from a job's log (one entry per step). */
export interface JobLogSection {
  /** Step number — matches RunStep.number for reliable association. */
  number: number;
  name: string;
  log: string;
}

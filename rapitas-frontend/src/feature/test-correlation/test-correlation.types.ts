/**
 * test-correlation.types
 *
 * Frontend-side mirror of the backend's test-correlation API response
 * shapes (routes/analytics/test-correlation). Contains no logic.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type RunSource = 'ci' | 'local' | 'manual';

export interface CorrelationCell {
  changedFile: string;
  testFile: string;
  correlation: number | null;
  pValue: number | null;
  sampleSize: number;
  confidence: ConfidenceLevel;
  nonDeterministic: boolean;
}

export interface MatrixResponse {
  success: true;
  windowMonths: number;
  cells: CorrelationCell[];
}

export interface FailureDrilldownEntry {
  runId: string;
  timestamp: string;
  commitSha: string | null;
  source: RunSource;
  environment: { platform: string; runtimeVersion: string };
  flaky: boolean;
}

export interface DrilldownResponse {
  success: true;
  entries: FailureDrilldownEntry[];
}

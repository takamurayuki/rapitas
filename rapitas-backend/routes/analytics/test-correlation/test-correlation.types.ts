/**
 * test-correlation route types
 *
 * Request/response shapes for GET /analytics/test-correlation/matrix,
 * GET /analytics/test-correlation/drilldown, and
 * POST /analytics/test-correlation/pr-scan. Contains no logic.
 */
import type {
  CorrelationCell,
  FailureDrilldownEntry,
  PrTestRiskEntry,
  TestRunStatus,
} from '../../../services/analytics/test-correlation';

export interface MatrixQuery {
  windowMonths?: number;
}

export interface MatrixResponse {
  success: true;
  windowMonths: number;
  cells: CorrelationCell[];
}

export interface DrilldownQuery {
  changedFile: string;
  testFile: string;
  windowMonths?: number;
}

export interface DrilldownResponse {
  success: true;
  entries: FailureDrilldownEntry[];
}

export interface PrScanBody {
  prNumber: number;
  prUrl?: string;
  windowMonths?: number;
  notify?: boolean;
}

export interface PrScanResponse {
  success: true;
  prNumber: number;
  entries: PrTestRiskEntry[];
  notified: boolean;
}

export interface ManualRunTestResult {
  file: string;
  status: TestRunStatus;
}

export interface ManualRunBody {
  changedFiles: string[];
  testResults: ManualRunTestResult[];
  commitSha?: string;
  environment?: {
    platform?: string;
    runtimeVersion?: string;
  };
}

export interface ManualRunResponse {
  success: true;
  runId: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
}

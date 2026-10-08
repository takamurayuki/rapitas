/**
 * test-correlation route validators
 *
 * Query/body validation for the test-correlation API. Returns a discriminated
 * result rather than throwing, so handlers can set the HTTP status themselves.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Default correlation/drilldown time window in months (matches run-history-store's retention). */
export const DEFAULT_WINDOW_MONTHS = 3;

const VALID_TEST_RUN_STATUSES = new Set(['pass', 'fail', 'skip']);

interface ValidatedManualRunTestResult {
  file: string;
  status: 'pass' | 'fail' | 'skip';
}

interface ValidatedManualRunBody {
  changedFiles: string[];
  testResults: ValidatedManualRunTestResult[];
  commitSha?: string;
  environment?: { platform?: string; runtimeVersion?: string };
}

/**
 * Validates the optional `windowMonths` query parameter.
 *
 * @param raw - Raw query value / 生のクエリ値
 * @returns Validated positive integer, defaulting to DEFAULT_WINDOW_MONTHS / 検証済みの月数
 */
export function validateWindowMonths(raw: unknown): ValidationResult<number> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: DEFAULT_WINDOW_MONTHS };
  }
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: 'windowMonths は正の整数で指定してください' };
  }
  return { ok: true, value: parsed };
}

/**
 * Validates the drilldown endpoint's required query parameters.
 *
 * @param query - Raw query object / 生のクエリオブジェクト
 * @returns Validated changedFile/testFile/windowMonths, or an error / 検証結果
 */
export function validateDrilldownQuery(
  query: Record<string, unknown>,
): ValidationResult<{ changedFile: string; testFile: string; windowMonths: number }> {
  const { changedFile, testFile } = query;
  if (typeof changedFile !== 'string' || changedFile.trim() === '') {
    return { ok: false, error: 'changedFile は必須です' };
  }
  if (typeof testFile !== 'string' || testFile.trim() === '') {
    return { ok: false, error: 'testFile は必須です' };
  }
  const windowResult = validateWindowMonths(query.windowMonths);
  if (!windowResult.ok) return windowResult;
  return { ok: true, value: { changedFile, testFile, windowMonths: windowResult.value } };
}

/**
 * Validates the PR-scan endpoint's request body.
 *
 * @param body - Raw request body / 生のリクエストボディ
 * @returns Validated prNumber/prUrl/windowMonths/notify, or an error / 検証結果
 */
export function validatePrScanBody(body: Record<string, unknown>): ValidationResult<{
  prNumber: number;
  prUrl?: string;
  windowMonths: number;
  notify: boolean;
}> {
  const { prNumber, prUrl, notify } = body;
  if (typeof prNumber !== 'number' || !Number.isInteger(prNumber) || prNumber <= 0) {
    return { ok: false, error: 'prNumber は正の整数で指定してください' };
  }
  if (prUrl !== undefined && typeof prUrl !== 'string') {
    return { ok: false, error: 'prUrl は文字列で指定してください' };
  }
  if (notify !== undefined && typeof notify !== 'boolean') {
    return { ok: false, error: 'notify は真偽値で指定してください' };
  }
  const windowResult = validateWindowMonths(body.windowMonths);
  if (!windowResult.ok) return windowResult;
  return {
    ok: true,
    value: {
      prNumber,
      prUrl,
      windowMonths: windowResult.value,
      notify: notify ?? true,
    },
  };
}

/**
 * Validates the manual-run endpoint's request body. `source` is deliberately
 * not an accepted field — the handler always hardcodes 'manual' so a client
 * cannot spoof 'ci'/'local' provenance (plan.md's 設計判断: source の設定).
 *
 * @param body - Raw request body / 生のリクエストボディ
 * @returns Validated changedFiles/testResults/commitSha/environment, or an error / 検証結果
 */
export function validateManualRunBody(
  body: Record<string, unknown>,
): ValidationResult<ValidatedManualRunBody> {
  const { changedFiles, testResults, commitSha, environment } = body;

  if (
    !Array.isArray(changedFiles) ||
    changedFiles.length === 0 ||
    !changedFiles.every((f) => typeof f === 'string' && f.trim() !== '')
  ) {
    return { ok: false, error: 'changedFiles は非空の文字列配列で指定してください' };
  }

  if (!Array.isArray(testResults) || testResults.length === 0) {
    return { ok: false, error: 'testResults は非空の配列で指定してください' };
  }
  const validatedResults: ValidatedManualRunTestResult[] = [];
  for (const entry of testResults) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).file !== 'string' ||
      ((entry as Record<string, unknown>).file as string).trim() === '' ||
      !VALID_TEST_RUN_STATUSES.has((entry as Record<string, unknown>).status as string)
    ) {
      return {
        ok: false,
        error: 'testResults の各要素は file（非空文字列）と status（pass/fail/skip）が必要です',
      };
    }
    validatedResults.push({
      file: (entry as Record<string, unknown>).file as string,
      status: (entry as Record<string, unknown>).status as 'pass' | 'fail' | 'skip',
    });
  }

  if (commitSha !== undefined && typeof commitSha !== 'string') {
    return { ok: false, error: 'commitSha は文字列で指定してください' };
  }

  if (environment !== undefined) {
    if (typeof environment !== 'object' || environment === null) {
      return { ok: false, error: 'environment はオブジェクトで指定してください' };
    }
    const { platform, runtimeVersion } = environment as Record<string, unknown>;
    if (platform !== undefined && typeof platform !== 'string') {
      return { ok: false, error: 'environment.platform は文字列で指定してください' };
    }
    if (runtimeVersion !== undefined && typeof runtimeVersion !== 'string') {
      return { ok: false, error: 'environment.runtimeVersion は文字列で指定してください' };
    }
  }

  return {
    ok: true,
    value: {
      changedFiles,
      testResults: validatedResults,
      commitSha: commitSha as string | undefined,
      environment: environment as { platform?: string; runtimeVersion?: string } | undefined,
    },
  };
}

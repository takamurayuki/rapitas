/**
 * test-correlation-pr-scan-hook
 *
 * Runs the PR test-risk scan right after a PR is created and notifies the
 * risky-test list. Fail-open by design: any failure is logged and swallowed so
 * that PR creation never depends on the correlation heatmap.
 */
import { resolve } from 'path';
import { createLogger } from '../../../config/logger';
import { loadFlakeHistoryOrEmpty, computeFlakeRate } from '../../../scripts/retry-policy';
import { runGhCommand } from '../../github/gh-client';
import { buildCorrelationMatrix } from './correlation-engine';
import { readRunHistory } from './run-history-store';
import { fetchPrChangedFiles, scorePrRisk, type GhRunner } from './pr-test-risk';
import { notifyPrTestRisk } from './test-correlation-notifier';

const log = createLogger('test-correlation-pr-scan-hook');

/** Backend root — three levels up from services/analytics/test-correlation. */
const BACKEND_ROOT = resolve(import.meta.dir, '..', '..', '..');

/**
 * Scans a freshly created PR's changed files against the correlation matrix and
 * sends the test-risk notification. Never rejects.
 *
 * @param prNumber - Created PR number / 作成したPR番号
 * @param prUrl - Created PR URL, linked from the notification / PRのURL
 * @param cwd - Repository directory used for the gh CLI / gh 実行ディレクトリ
 * @param runGh - gh runner (DI for tests) / gh 実行関数
 */
export async function scanPrTestRiskAfterCreate(
  prNumber: number,
  prUrl: string | undefined,
  cwd: string,
  runGh: GhRunner = runGhCommand,
): Promise<void> {
  try {
    const changedFiles = await fetchPrChangedFiles(cwd, prNumber, runGh);
    const { runs } = readRunHistory(BACKEND_ROOT);
    const flakeHistory = loadFlakeHistoryOrEmpty(BACKEND_ROOT);
    const flakeRates = Object.fromEntries(
      Object.entries(flakeHistory.entries).map(([file, entry]) => [file, computeFlakeRate(entry)]),
    );
    const matrix = buildCorrelationMatrix(runs, { flakeRates });
    await notifyPrTestRisk(prNumber, scorePrRisk(changedFiles, matrix), prUrl);
  } catch (err) {
    log.warn({ err, prNumber }, 'PR test-risk scan failed; PR creation is unaffected');
  }
}

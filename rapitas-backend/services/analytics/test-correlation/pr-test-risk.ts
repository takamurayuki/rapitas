/**
 * pr-test-risk
 *
 * Detects a PR's changed files via `gh pr view` (DI'd runner, mirroring
 * services/self-improvement/pr-risk/pr-risk-features.ts's GhRunner pattern)
 * and scores each test file's failure risk from the correlation matrix.
 */
import type { CorrelationCell } from './test-correlation.types';

export type GhRunner = (args: string[], cwd: string) => Promise<string>;

export interface GhPrFilesResponse {
  files: Array<{ path: string }>;
}

/** One test file's PR-scan risk result. */
export interface PrTestRiskEntry {
  testFile: string;
  /** Highest positive correlation among the PR's changed files, clamped to [0, 1]. 0 when no match. */
  riskScore: number;
  confidence: CorrelationCell['confidence'];
  nonDeterministic: boolean;
  /** Changed files that contributed to riskScore, most-correlated first. */
  contributingFiles: string[];
}

/**
 * Fetches a PR's changed file list via `gh pr view --json files`.
 *
 * @param cwd - Repo working directory / 作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @param runGh - gh runner (DI — tests must not invoke the real `gh` CLI) / gh 実行関数
 * @returns Changed file paths, POSIX-separated / 変更ファイル一覧
 * @throws {Error} When gh fails or returns unparsable JSON / gh 失敗時
 */
export async function fetchPrChangedFiles(
  cwd: string,
  prNumber: number,
  runGh: GhRunner,
): Promise<string[]> {
  const out = await runGh(['pr', 'view', String(prNumber), '--json', 'files'], cwd);
  const json = JSON.parse(out) as GhPrFilesResponse;
  if (!Array.isArray(json.files)) {
    throw new Error(`pr-test-risk: unexpected gh pr view output for #${prNumber}`);
  }
  return json.files.map((f) => f.path.replace(/\\/g, '/'));
}

/**
 * Scores every test file's failure risk against a PR's changed files, using
 * the strongest positive correlation among the changed files as the score.
 * Negative correlations do not indicate risk and are excluded. Low-confidence
 * cells are still scored (not dropped) — callers must surface `confidence`
 * alongside the score so uncertainty is never hidden (受入条件3).
 *
 * @param changedFiles - PR's changed files / PRの変更ファイル一覧
 * @param matrix - Correlation matrix cells / 相関マトリックス
 * @returns Risk entries sorted by riskScore descending / リスク降順のエントリ一覧
 */
export function scorePrRisk(changedFiles: string[], matrix: CorrelationCell[]): PrTestRiskEntry[] {
  const changedSet = new Set(changedFiles);
  const byTestFile = new Map<string, PrTestRiskEntry>();

  for (const cell of matrix) {
    if (!changedSet.has(cell.changedFile)) continue;
    if (cell.correlation === null || cell.correlation <= 0) continue;

    const score = Math.min(1, cell.correlation);
    const existing = byTestFile.get(cell.testFile);
    if (!existing || score > existing.riskScore) {
      byTestFile.set(cell.testFile, {
        testFile: cell.testFile,
        riskScore: score,
        confidence: cell.confidence,
        nonDeterministic: cell.nonDeterministic,
        contributingFiles: [cell.changedFile],
      });
    } else if (existing && score === existing.riskScore) {
      existing.contributingFiles.push(cell.changedFile);
    }
  }

  return Array.from(byTestFile.values()).sort((a, b) => b.riskScore - a.riskScore);
}

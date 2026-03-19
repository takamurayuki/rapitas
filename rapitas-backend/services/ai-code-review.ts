/**
 * AICodeReview
 *
 * Analyzes git diffs to generate automated code review comments.
 * Reviews security risks, performance concerns, test coverage, and plan compliance.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../config/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('ai-code-review');

/** Single review finding from the analysis. */
export type ReviewFinding = {
  file: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'security' | 'performance' | 'test_coverage' | 'plan_compliance' | 'best_practice';
  message: string;
  line?: number;
};

/** Aggregated review result for a branch. */
export type CodeReviewResult = {
  riskLevel: 'low' | 'medium' | 'high';
  findings: ReviewFinding[];
  summary: string;
  reviewedFiles: number;
  totalFindings: number;
};

/** Patterns that indicate security risks in diffs. */
const SECURITY_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /eval\s*\(/, message: 'eval() usage detected — potential code injection risk' },
  { pattern: /innerHTML\s*=/, message: 'innerHTML assignment — potential XSS risk' },
  { pattern: /dangerouslySetInnerHTML/, message: 'dangerouslySetInnerHTML — ensure input is sanitized' },
  { pattern: /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE)\b/i, message: 'Template literal in SQL — potential SQL injection' },
  { pattern: /(?:password|secret|api_key|token)\s*[:=]\s*['"][^'"]+['"]/i, message: 'Hardcoded secret detected' },
  { pattern: /cors\(\s*\{[^}]*origin\s*:\s*['"]?\*/i, message: 'CORS wildcard origin — consider restricting' },
];

/** Patterns that indicate performance concerns. */
const PERFORMANCE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\.forEach\(.*await\b/, message: 'await inside forEach — use for...of or Promise.all instead' },
  { pattern: /SELECT\s+\*/i, message: 'SELECT * query — consider selecting specific columns' },
  { pattern: /new RegExp\(/, message: 'Dynamic RegExp in hot path — consider pre-compiling' },
  { pattern: /JSON\.parse\(JSON\.stringify\(/, message: 'Deep clone via JSON — use structuredClone() instead' },
];

/**
 * Run a code review on a branch's diff against the base branch.
 *
 * @param workingDirectory - Repository root / リポジトリルート
 * @param baseBranch - Base branch for diff / diff比較用ベースブランチ
 * @param planContent - Original plan for compliance check / 計画準拠チェック用の元プラン
 * @returns Code review result / コードレビュー結果
 */
export async function reviewBranchDiff(
  workingDirectory: string,
  baseBranch: string = 'develop',
  planContent?: string,
): Promise<CodeReviewResult> {
  const findings: ReviewFinding[] = [];
  let reviewedFiles = 0;

  try {
    const { stdout: diff } = await execFileAsync(
      'git',
      ['diff', `${baseBranch}...HEAD`],
      { cwd: workingDirectory, timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
    );

    let currentFile = '';

    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        reviewedFiles++;
        continue;
      }

      // NOTE: Only scan added lines to avoid flagging existing code
      if (!line.startsWith('+') || line.startsWith('+++')) continue;

      // Security checks
      for (const { pattern, message } of SECURITY_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            file: currentFile,
            severity: 'critical',
            category: 'security',
            message,
          });
        }
      }

      // Performance checks
      for (const { pattern, message } of PERFORMANCE_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            file: currentFile,
            severity: 'warning',
            category: 'performance',
            message,
          });
        }
      }
    }

    // Plan compliance check
    if (planContent) {
      const planFiles = extractPlanFiles(planContent);
      const diffFiles = extractDiffFiles(diff);
      const unplannedFiles = diffFiles.filter((f) => !planFiles.some((pf) => f.includes(pf)));

      for (const file of unplannedFiles.slice(0, 5)) {
        findings.push({
          file,
          severity: 'info',
          category: 'plan_compliance',
          message: `Plan外のファイル変更 — 意図的な変更か確認してください`,
        });
      }
    }

    // Test coverage check
    const { stdout: changedFiles } = await execFileAsync(
      'git',
      ['diff', '--name-only', `${baseBranch}...HEAD`],
      { cwd: workingDirectory, timeout: 10000 },
    );

    const srcFiles = changedFiles.split('\n').filter(
      (f) => /\.(ts|tsx|js|jsx)$/.test(f) && !f.includes('.test.') && !f.includes('.spec.'),
    );
    const testFiles = changedFiles.split('\n').filter(
      (f) => f.includes('.test.') || f.includes('.spec.'),
    );

    if (srcFiles.length > 0 && testFiles.length === 0) {
      findings.push({
        file: srcFiles[0],
        severity: 'warning',
        category: 'test_coverage',
        message: `${srcFiles.length}個のソースファイルが変更されていますがテストファイルの変更がありません`,
      });
    }
  } catch (error) {
    log.error({ err: error }, '[CodeReview] Failed to analyze diff');
  }

  // Deduplicate findings by file + message
  const uniqueFindings = deduplicateFindings(findings);
  const criticalCount = uniqueFindings.filter((f) => f.severity === 'critical').length;
  const warningCount = uniqueFindings.filter((f) => f.severity === 'warning').length;

  const riskLevel: CodeReviewResult['riskLevel'] =
    criticalCount > 0 ? 'high' : warningCount > 2 ? 'medium' : 'low';

  const summary = buildSummary(uniqueFindings, reviewedFiles, riskLevel);

  log.info(
    `[CodeReview] Completed: ${reviewedFiles} files, ${uniqueFindings.length} findings, risk=${riskLevel}`,
  );

  return {
    riskLevel,
    findings: uniqueFindings,
    summary,
    reviewedFiles,
    totalFindings: uniqueFindings.length,
  };
}

/**
 * Post review findings as a GitHub PR comment.
 *
 * @param workingDirectory - Repository root / リポジトリルート
 * @param prNumber - PR number / PR番号
 * @param review - Code review result / コードレビュー結果
 */
export async function postReviewToPR(
  workingDirectory: string,
  prNumber: number,
  review: CodeReviewResult,
): Promise<void> {
  if (review.totalFindings === 0) {
    log.info(`[CodeReview] No findings for PR #${prNumber}, skipping comment`);
    return;
  }

  const body = formatReviewAsMarkdown(review);
  const ghPath =
    process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';

  try {
    await execFileAsync(
      process.platform === 'win32' ? 'cmd' : 'sh',
      process.platform === 'win32'
        ? ['/c', `${ghPath} pr comment ${prNumber} --body "${body.replace(/"/g, '\\"')}"`]
        : ['-c', `${ghPath} pr comment ${prNumber} --body '${body.replace(/'/g, "'\\''")}'`],
      { cwd: workingDirectory, timeout: 15000 },
    );
    log.info(`[CodeReview] Posted review comment to PR #${prNumber}`);
  } catch (error) {
    log.error({ err: error }, `[CodeReview] Failed to post comment to PR #${prNumber}`);
  }
}

function extractPlanFiles(plan: string): string[] {
  const matches = plan.match(/[\w\-./]+\.[a-zA-Z]{1,10}/g) || [];
  return [...new Set(matches.filter((m) => m.includes('/') && !m.match(/^v?\d+\.\d+/)))];
}

function extractDiffFiles(diff: string): string[] {
  return diff
    .split('\n')
    .filter((l) => l.startsWith('+++ b/'))
    .map((l) => l.slice(6));
}

function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSummary(
  findings: ReviewFinding[],
  filesReviewed: number,
  riskLevel: string,
): string {
  const byCat = new Map<string, number>();
  for (const f of findings) {
    byCat.set(f.category, (byCat.get(f.category) || 0) + 1);
  }

  const parts = [`${filesReviewed}ファイルをレビュー、${findings.length}件の指摘 (リスク: ${riskLevel})`];
  for (const [cat, count] of byCat) {
    parts.push(`- ${cat}: ${count}件`);
  }

  return parts.join('\n');
}

function formatReviewAsMarkdown(review: CodeReviewResult): string {
  const riskBadge =
    review.riskLevel === 'high' ? '🔴 High' : review.riskLevel === 'medium' ? '🟡 Medium' : '🟢 Low';

  const lines = [
    `## 🤖 AI Code Review`,
    ``,
    `**Risk Level**: ${riskBadge} | **Files**: ${review.reviewedFiles} | **Findings**: ${review.totalFindings}`,
    ``,
  ];

  const grouped = new Map<string, ReviewFinding[]>();
  for (const f of review.findings) {
    const list = grouped.get(f.category) || [];
    list.push(f);
    grouped.set(f.category, list);
  }

  for (const [category, items] of grouped) {
    lines.push(`### ${category}`);
    for (const item of items.slice(0, 10)) {
      const icon = item.severity === 'critical' ? '🔴' : item.severity === 'warning' ? '🟡' : 'ℹ️';
      lines.push(`- ${icon} \`${item.file}\`: ${item.message}`);
    }
    lines.push('');
  }

  lines.push('---', '🤖 Generated by Rapitas AI Code Review');

  return lines.join('\n');
}

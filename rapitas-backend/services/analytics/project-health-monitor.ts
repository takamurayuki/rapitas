/**
 * ProjectHealthMonitor
 *
 * Continuously monitors project health in the background.
 * Detects: stale branches, dependency issues, commit frequency anomalies,
 * uncommitted work, and potential conflicts with teammate changes.
 * Runs at zero API cost (local git commands only).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createNotification } from '../communication/notification-service';
import { sendWebhookNotification } from '../communication/webhook-notification-service';

const log = createLogger('project-health-monitor');

/** Individual health check result. */
export type HealthCheckItem = {
  type: 'stale_branch' | 'uncommitted_work' | 'low_commit_frequency' | 'dependency_issue' | 'large_diff' | 'conflict_risk';
  severity: 'info' | 'warning' | 'critical';
  project: string;
  message: string;
  details?: string;
  actionable: boolean;
  suggestedAction?: string;
};

/** Full health report for all monitored projects. */
export type ProjectHealthReport = {
  checkedAt: Date;
  projectsChecked: number;
  items: HealthCheckItem[];
  summary: string;
  overallHealth: 'healthy' | 'attention_needed' | 'critical';
};

/**
 * Run health checks on a single project directory.
 *
 * @param workingDirectory - Project root / プロジェクトルート
 * @param projectName - Display name / 表示名
 * @returns Health check items / ヘルスチェック項目
 */
export async function checkProjectHealth(
  workingDirectory: string,
  projectName: string,
): Promise<HealthCheckItem[]> {
  const items: HealthCheckItem[] = [];

  try {
    const { execSync } = await import('child_process');
    const run = (cmd: string) =>
      execSync(cmd, { cwd: workingDirectory, encoding: 'utf8', timeout: 10000 }).trim();

    // 1. Stale branches (no commits in 30+ days)
    try {
      const branches = run(
        `git for-each-ref --sort=-committerdate --format="%(refname:short) %(committerdate:relative)" refs/heads/ | head -20`,
      );
      for (const line of branches.split('\n').filter(Boolean)) {
        const parts = line.split(' ');
        const branch = parts[0];
        const dateStr = parts.slice(1).join(' ');
        if (
          branch !== 'develop' && branch !== 'main' && branch !== 'master' &&
          (dateStr.includes('month') || dateStr.includes('year'))
        ) {
          items.push({
            type: 'stale_branch',
            severity: 'info',
            project: projectName,
            message: `ブランチ「${branch}」に${dateStr}コミットがありません`,
            actionable: true,
            suggestedAction: `git branch -d ${branch}`,
          });
        }
      }
    } catch { /* non-fatal */ }

    // 2. Uncommitted work
    try {
      const status = run('git status --porcelain');
      const changedFiles = status.split('\n').filter(Boolean).length;
      if (changedFiles > 10) {
        items.push({
          type: 'uncommitted_work',
          severity: 'warning',
          project: projectName,
          message: `${changedFiles}個の未コミットファイルがあります`,
          actionable: true,
          suggestedAction: 'git add . && git commit',
        });
      }
    } catch { /* non-fatal */ }

    // 3. Commit frequency (no commits in 7+ days on active branch)
    try {
      const lastCommit = run('git log -1 --format="%ci"');
      if (lastCommit) {
        const lastDate = new Date(lastCommit);
        const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > 7) {
          items.push({
            type: 'low_commit_frequency',
            severity: 'info',
            project: projectName,
            message: `最終コミットから${Math.round(daysSince)}日経過しています`,
            actionable: false,
          });
        }
      }
    } catch { /* non-fatal */ }

    // 4. Dependency issues (npm audit / outdated)
    try {
      const hasPackageJson = run('test -f package.json && echo yes || echo no');
      if (hasPackageJson === 'yes') {
        try {
          const auditResult = run('npm audit --json 2>/dev/null | head -100');
          const audit = JSON.parse(auditResult);
          const vulns = audit.metadata?.vulnerabilities || {};
          const highCount = (vulns.high || 0) + (vulns.critical || 0);
          if (highCount > 0) {
            items.push({
              type: 'dependency_issue',
              severity: 'critical',
              project: projectName,
              message: `${highCount}個の高/重大な脆弱性が検出されました`,
              actionable: true,
              suggestedAction: 'npm audit fix',
            });
          }
        } catch { /* npm audit may fail */ }
      }
    } catch { /* non-fatal */ }

    // 5. Large uncommitted diff
    try {
      const diffStat = run('git diff --stat HEAD 2>/dev/null | tail -1');
      if (diffStat) {
        const insertions = diffStat.match(/(\d+) insertion/);
        const deletions = diffStat.match(/(\d+) deletion/);
        const totalChanges = (parseInt(insertions?.[1] || '0') + parseInt(deletions?.[1] || '0'));
        if (totalChanges > 500) {
          items.push({
            type: 'large_diff',
            severity: 'warning',
            project: projectName,
            message: `未コミットの差分が${totalChanges}行あります。コミット粒度を小さくすることを推奨`,
            actionable: true,
            suggestedAction: '変更を論理単位でコミットしてください',
          });
        }
      }
    } catch { /* non-fatal */ }

    // 6. Remote branch conflict detection
    try {
      run('git fetch --dry-run 2>&1');
      const currentBranch = run('git branch --show-current');
      if (currentBranch && currentBranch !== 'develop' && currentBranch !== 'main') {
        const behindCount = run(
          `git rev-list --count HEAD..origin/develop 2>/dev/null || echo 0`,
        );
        const behind = parseInt(behindCount || '0');
        if (behind > 20) {
          items.push({
            type: 'conflict_risk',
            severity: 'warning',
            project: projectName,
            message: `developブランチから${behind}コミット遅れています。マージコンフリクトのリスクが高まっています`,
            actionable: true,
            suggestedAction: `git merge develop`,
          });
        }
      }
    } catch { /* non-fatal */ }

  } catch (error) {
    log.error({ err: error }, `[HealthMonitor] Health check failed for ${projectName}`);
  }

  return items;
}

/**
 * Run health checks on all monitored projects and generate a report.
 *
 * @returns Full health report / 全プロジェクトのヘルスレポート
 */
export async function runProjectHealthScan(): Promise<ProjectHealthReport> {
  log.info('[HealthMonitor] Starting project health scan');

  const themes = await prisma.theme.findMany({
    where: { workingDirectory: { not: null } },
    select: { id: true, name: true, workingDirectory: true },
  });

  const allItems: HealthCheckItem[] = [];

  for (const theme of themes) {
    if (!theme.workingDirectory) continue;
    try {
      const items = await checkProjectHealth(theme.workingDirectory, theme.name);
      allItems.push(...items);
    } catch (err) {
      log.warn({ err }, `[HealthMonitor] Check failed for theme ${theme.name}`);
    }
  }

  const criticalCount = allItems.filter((i) => i.severity === 'critical').length;
  const warningCount = allItems.filter((i) => i.severity === 'warning').length;

  const overallHealth: ProjectHealthReport['overallHealth'] =
    criticalCount > 0 ? 'critical'
    : warningCount > 2 ? 'attention_needed'
    : 'healthy';

  const summary =
    allItems.length === 0
      ? '全プロジェクトが健全です'
      : `${themes.length}プロジェクトをチェック: ${criticalCount}件の重大な問題、${warningCount}件の警告`;

  const report: ProjectHealthReport = {
    checkedAt: new Date(),
    projectsChecked: themes.length,
    items: allItems,
    summary,
    overallHealth,
  };

  // Notify if issues found
  if (criticalCount > 0 || warningCount > 2) {
    await createNotification({
      type: 'system',
      title: 'プロジェクトヘルスアラート',
      message: summary,
      link: '/dashboard',
      metadata: { report },
    });

    void sendWebhookNotification('execution_error', {
      message: `🩺 Project Health: ${summary}`,
    });
  }

  log.info(
    `[HealthMonitor] Scan complete: ${themes.length} projects, ${allItems.length} items (${overallHealth})`,
  );

  return report;
}

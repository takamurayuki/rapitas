/**
 * TechDebtLiquidator
 *
 * Autonomously detects and proposes fixes for tech debt during idle time.
 * Uses local LLM (zero cost) to analyze code and generate small, safe PRs.
 * Runs as a background scheduled job via BehaviorScheduler.
 */
import { prisma } from '../config/database';
import { createLogger } from '../config/logger';
import { createNotification } from '../communication/notification-service';
import { sendWebhookNotification } from './webhook-notification-service';

const log = createLogger('tech-debt-liquidator');

/** A single detected tech debt item. */
export type TechDebtItem = {
  id: string;
  type: 'dead_code' | 'type_safety' | 'missing_test' | 'complexity' | 'deprecated_api' | 'large_file';
  severity: 'low' | 'medium' | 'high';
  file: string;
  line?: number;
  description: string;
  suggestedFix?: string;
  estimatedEffort: 'trivial' | 'small' | 'medium';
};

/** Result of a tech debt scan. */
export type TechDebtScanResult = {
  scannedAt: Date;
  workingDirectory: string;
  items: TechDebtItem[];
  totalFiles: number;
  summary: string;
};

/** Result of an auto-fix attempt. */
export type TechDebtFixResult = {
  itemId: string;
  success: boolean;
  branchName?: string;
  commitHash?: string;
  error?: string;
};

/** Digest of tech debt activity for notifications. */
export type TechDebtDigest = {
  period: string;
  scannedThemes: number;
  itemsFound: number;
  itemsByType: Record<string, number>;
  topItems: TechDebtItem[];
};

/**
 * Scan a working directory for tech debt patterns.
 *
 * @param workingDirectory - Project root to scan / スキャン対象のプロジェクトルート
 * @returns Scan result with detected items / 検出されたアイテムを含むスキャン結果
 */
export async function scanForTechDebt(
  workingDirectory: string,
): Promise<TechDebtScanResult> {
  const items: TechDebtItem[] = [];
  let totalFiles = 0;

  try {
    const { execSync } = await import('child_process');

    // 1. Find large files (>500 lines)
    try {
      const result = execSync(
        `git ls-files "*.ts" "*.tsx" "*.js" "*.jsx" | head -200`,
        { cwd: workingDirectory, encoding: 'utf8', timeout: 15000 },
      );
      const files = result.trim().split('\n').filter(Boolean);
      totalFiles = files.length;

      for (const file of files) {
        try {
          const wc = execSync(`wc -l < "${file}"`, {
            cwd: workingDirectory, encoding: 'utf8', timeout: 5000,
          }).trim();
          const lineCount = parseInt(wc);
          if (lineCount > 500) {
            items.push({
              id: `large-${file}`,
              type: 'large_file',
              severity: lineCount > 1000 ? 'high' : 'medium',
              file,
              description: `${lineCount}行 — ファイルが大きすぎます。分割を検討してください`,
              estimatedEffort: 'medium',
            });
          }
        } catch { /* skip individual file errors */ }
      }
    } catch (err) {
      log.debug({ err }, '[TechDebt] File size scan failed');
    }

    // 2. Find any type usage
    try {
      const anyUsage = execSync(
        `git grep -n ": any" -- "*.ts" "*.tsx" | head -50`,
        { cwd: workingDirectory, encoding: 'utf8', timeout: 15000 },
      );
      const anyLines = anyUsage.trim().split('\n').filter(Boolean);
      // NOTE: Group by file to avoid noise
      const fileGroups = new Map<string, number>();
      for (const line of anyLines) {
        const file = line.split(':')[0];
        fileGroups.set(file, (fileGroups.get(file) || 0) + 1);
      }
      for (const [file, count] of fileGroups) {
        if (count >= 3) {
          items.push({
            id: `any-${file}`,
            type: 'type_safety',
            severity: count >= 10 ? 'high' : 'medium',
            file,
            description: `${count}箇所で \`any\` 型が使用されています`,
            suggestedFix: `具体的な型定義に置き換えてください`,
            estimatedEffort: count >= 10 ? 'medium' : 'small',
          });
        }
      }
    } catch { /* grep returns non-zero if no matches */ }

    // 3. Find TODO/FIXME/HACK comments
    try {
      const todos = execSync(
        `git grep -n "TODO\\|FIXME\\|HACK" -- "*.ts" "*.tsx" | head -50`,
        { cwd: workingDirectory, encoding: 'utf8', timeout: 15000 },
      );
      const todoLines = todos.trim().split('\n').filter(Boolean);
      const fileGroups = new Map<string, string[]>();
      for (const line of todoLines) {
        const [filePart, ...rest] = line.split(':');
        const file = filePart;
        const existing = fileGroups.get(file) || [];
        existing.push(rest.join(':').trim());
        fileGroups.set(file, existing);
      }
      for (const [file, comments] of fileGroups) {
        const hackCount = comments.filter((c) => c.includes('HACK') || c.includes('FIXME')).length;
        if (hackCount > 0) {
          items.push({
            id: `todo-${file}`,
            type: 'deprecated_api',
            severity: hackCount >= 3 ? 'high' : 'low',
            file,
            description: `${hackCount}個のHACK/FIXMEコメント — 技術的負債の明示的マーカー`,
            estimatedEffort: 'small',
          });
        }
      }
    } catch { /* grep returns non-zero if no matches */ }

    // 4. Find files with no corresponding test file
    try {
      const srcFiles = execSync(
        `git ls-files "src/**/*.ts" "services/**/*.ts" "routes/**/*.ts" | grep -v ".test." | grep -v ".spec." | grep -v "index.ts" | head -100`,
        { cwd: workingDirectory, encoding: 'utf8', timeout: 10000 },
      );
      const testFiles = execSync(
        `git ls-files "**/*.test.ts" "**/*.spec.ts" "tests/**/*.ts" | head -200`,
        { cwd: workingDirectory, encoding: 'utf8', timeout: 10000 },
      );
      const testSet = new Set(testFiles.trim().split('\n').filter(Boolean).map((f) =>
        f.replace(/\.test\.ts$|\.spec\.ts$/, '').replace(/^tests\//, ''),
      ));

      const untestedFiles = srcFiles.trim().split('\n').filter(Boolean).filter((f) => {
        const baseName = f.replace(/\.ts$/, '');
        return !testSet.has(baseName) && !testSet.has(f.replace(/\.ts$/, ''));
      });

      if (untestedFiles.length > 10) {
        items.push({
          id: 'missing-tests-bulk',
          type: 'missing_test',
          severity: 'medium',
          file: `${untestedFiles.length}ファイル`,
          description: `${untestedFiles.length}個のソースファイルに対応するテストファイルがありません`,
          estimatedEffort: 'medium',
        });
      }
    } catch { /* non-fatal */ }

  } catch (error) {
    log.error({ err: error }, '[TechDebt] Scan failed');
  }

  // Sort by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const summary = `${totalFiles}ファイルをスキャン、${items.length}件の技術的負債を検出（高: ${items.filter((i) => i.severity === 'high').length}, 中: ${items.filter((i) => i.severity === 'medium').length}, 低: ${items.filter((i) => i.severity === 'low').length}）`;

  log.info(`[TechDebt] ${summary}`);

  return {
    scannedAt: new Date(),
    workingDirectory,
    items: items.slice(0, 50),
    totalFiles,
    summary,
  };
}

/**
 * Run tech debt scan for all active themes and generate a digest notification.
 *
 * @returns Digest of scan results / スキャン結果のダイジェスト
 */
export async function runScheduledTechDebtScan(): Promise<TechDebtDigest> {
  log.info('[TechDebt] Starting scheduled scan');

  const themes = await prisma.theme.findMany({
    where: { workingDirectory: { not: null } },
    select: { id: true, name: true, workingDirectory: true },
  });

  const allItems: TechDebtItem[] = [];

  for (const theme of themes) {
    if (!theme.workingDirectory) continue;
    try {
      const result = await scanForTechDebt(theme.workingDirectory);
      allItems.push(...result.items);
    } catch (err) {
      log.warn({ err }, `[TechDebt] Scan failed for theme ${theme.name}`);
    }
  }

  const itemsByType: Record<string, number> = {};
  for (const item of allItems) {
    itemsByType[item.type] = (itemsByType[item.type] || 0) + 1;
  }

  const digest: TechDebtDigest = {
    period: new Date().toISOString().split('T')[0],
    scannedThemes: themes.length,
    itemsFound: allItems.length,
    itemsByType,
    topItems: allItems.slice(0, 10),
  };

  // Send notification if items found
  if (allItems.length > 0) {
    const highCount = allItems.filter((i) => i.severity === 'high').length;
    const message = `${allItems.length}件の技術的負債を検出（高優先: ${highCount}件）`;

    await createNotification({
      type: 'system',
      title: 'テックデット分析レポート',
      message,
      link: '/dashboard',
      metadata: { digest },
    });

    void sendWebhookNotification('task_completed', {
      message: `🔧 Tech Debt Report: ${message}`,
    });
  }

  log.info(
    `[TechDebt] Scheduled scan complete: ${themes.length} themes, ${allItems.length} items`,
  );

  return digest;
}

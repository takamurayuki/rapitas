/**
 * I18nIntegrityScheduler
 *
 * Periodic scheduler that guards rapitas-frontend/messages/{ja,en}.json
 * against the recurring silent working-tree reversion described in
 * i18n-integrity-check.ts. Runs every few minutes so a corrupted file is
 * restored long before a user notices a MISSING_MESSAGE error, regardless
 * of whether the root cause (concern #10168) is ever pinned down.
 */
import { createLogger } from '../../config/logger';
import { getProjectRoot } from '../../config';
import { checkAndHealAllMessagesFiles } from '../system/i18n-integrity-check';

const logger = createLogger('i18n-integrity-scheduler');

export class I18nIntegrityScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly defaultIntervalMs = 3 * 60 * 1000; // 3 minutes

  /**
   * Start the periodic integrity check.
   *
   * @param intervalMs - Check interval in milliseconds. / チェック間隔（ミリ秒）
   * @param baseDir - Repository root (defaults to project root). / リポジトリルート（既定はプロジェクトルート）
   */
  start(intervalMs?: number, baseDir?: string): void {
    if (this.isRunning) {
      logger.warn('[I18nIntegrityScheduler] Already running, ignoring start request');
      return;
    }

    const interval = intervalMs ?? this.defaultIntervalMs;
    const workingDir = baseDir ?? getProjectRoot();

    logger.info(
      `[I18nIntegrityScheduler] Starting scheduler with ${interval}ms interval for ${workingDir}`,
    );

    this.isRunning = true;

    this.runCheck(workingDir).catch((error) => {
      logger.error({ err: error }, '[I18nIntegrityScheduler] Initial check failed');
    });

    this.intervalId = setInterval(() => {
      this.runCheck(workingDir).catch((error) => {
        logger.error({ err: error }, '[I18nIntegrityScheduler] Scheduled check failed');
      });
    }, interval);

    logger.info('[I18nIntegrityScheduler] Started successfully');
  }

  /** Stop the periodic integrity check. */
  stop(): void {
    if (!this.isRunning) {
      logger.debug('[I18nIntegrityScheduler] Not running, ignoring stop request');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info('[I18nIntegrityScheduler] Stopped');
  }

  /**
   * @returns True if running. / 実行中の場合true
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  private async runCheck(baseDir: string): Promise<void> {
    try {
      const results = await checkAndHealAllMessagesFiles(baseDir);
      const healed = Object.entries(results).filter(([, v]) => v === 'healed');
      if (healed.length > 0) {
        // NOTE: Summary only — i18n-integrity-check already emits a per-file WARN
        // ("restored from HEAD") that keeps the reversion frequency observable
        // (concern #10168). A second WARN here was auto-filed as a duplicate concern.
        logger.info(
          { files: healed.map(([f]) => f) },
          '[I18nIntegrityScheduler] Healed reverted message file(s)',
        );
      } else {
        logger.debug(
          { results },
          '[I18nIntegrityScheduler] Check cycle completed — no healing needed',
        );
      }
    } catch (error) {
      logger.error({ err: error }, '[I18nIntegrityScheduler] Check cycle failed');
      // Don't throw - let the scheduler continue running
    }
  }
}

let globalScheduler: I18nIntegrityScheduler | null = null;

/**
 * @returns Global scheduler instance. / グローバルスケジューラインスタンス
 */
export function getI18nIntegrityScheduler(): I18nIntegrityScheduler {
  if (!globalScheduler) {
    globalScheduler = new I18nIntegrityScheduler();
  }
  return globalScheduler;
}

/**
 * Start the global i18n integrity scheduler.
 *
 * @param intervalMs - Optional check interval in milliseconds. / オプションのチェック間隔（ミリ秒）
 * @param baseDir - Optional repository root. / オプションのリポジトリルート
 */
export function startI18nIntegrityScheduler(intervalMs?: number, baseDir?: string): void {
  const scheduler = getI18nIntegrityScheduler();
  scheduler.start(intervalMs, baseDir);
}

/** Stop the global i18n integrity scheduler. */
export function stopI18nIntegrityScheduler(): void {
  const scheduler = getI18nIntegrityScheduler();
  scheduler.stop();
}

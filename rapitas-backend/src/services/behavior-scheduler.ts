import { UserBehaviorService } from './user-behavior-service';
import { createLogger } from '../../config/logger';
import { memoryTaskQueue } from '../../services/memory';
import { scanAndRemind } from '../../services/memory/knowledge-reminder';
import { revalidateStaleConflicts } from '../../services/memory/contradiction';
import { generateOptimizationRules } from '../../services/workflow/learning/workflow-learning-optimizer';
import { processAllPendingRecurrences } from '../../services/scheduling/recurring-task-service';
import { runScheduledTechDebtScan } from '../../services/misc/tech-debt-liquidator';
import { runProjectHealthScan } from '../../services/analytics/project-health-monitor';
import { generateWeeklyReview } from '../../services/ai/weekly-review-service';
import { prisma } from '../../config/database';

const log = createLogger('behavior-scheduler');

export class BehaviorScheduler {
  private static intervalIds: NodeJS.Timeout[] = [];

  /**
   * Start scheduler
   */
  static start() {
    log.info('[BehaviorScheduler] Starting behavior summary update scheduler');

    // NOTE: Consolidated from 11 separate setInterval calls into one to reduce
    // JS event-loop timer overhead (11 callbacks/min → 1). All original guards
    // (hour/minute/day-of-week/day-of-month) are preserved inside the single tick.
    const tick = setInterval(async () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const dow = now.getDay(); // 0=Sun … 6=Sat
      const dom = now.getDate();

      // Top of every hour: daily summary + recurring tasks
      if (m === 0) {
        log.info('[BehaviorScheduler] Updating daily behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'daily').catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Daily summary failed');
        });
        log.info(`[BehaviorScheduler] Processing recurring tasks at hour ${h}`);
        await processAllPendingRecurrences(prisma, h).catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Recurring task processing failed');
        });
      }

      // Midnight: weekly / monthly summary + knowledge consolidation
      if (h === 0 && m === 0) {
        log.info('[BehaviorScheduler] Updating weekly behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'weekly').catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Weekly summary failed');
        });
        if (dom === 1) {
          log.info('[BehaviorScheduler] Updating monthly behavior summary');
          await UserBehaviorService.updateBehaviorSummary(1, 'monthly').catch((err: Error) => {
            log.error({ err }, '[BehaviorScheduler] Monthly summary failed');
          });
        }
        log.info('[BehaviorScheduler] Triggering knowledge consolidation');
        await memoryTaskQueue.enqueue('consolidate', {}).catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to enqueue consolidation');
        });
      }

      // 2 AM: forgetting sweep
      if (h === 2 && m === 0) {
        log.info('[BehaviorScheduler] Triggering forgetting sweep');
        await memoryTaskQueue.enqueue('forget_sweep', {}).catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to enqueue forgetting sweep');
        });
      }

      // 3 AM: workflow optimization rules
      if (h === 3 && m === 0) {
        log.info('[BehaviorScheduler] Triggering workflow optimization rule generation');
        await generateOptimizationRules().catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to generate optimization rules');
        });
      }

      // 4 AM: tech debt scan
      if (h === 4 && m === 0) {
        log.info('[BehaviorScheduler] Running autonomous tech debt scan');
        await runScheduledTechDebtScan().catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Tech debt scan failed');
        });
      }

      // 5 AM: stale-conflict revalidation — 'conflict' knowledge must be able
      // to recover (or die) without a human; otherwise recall trust-demotes a
      // growing share of the KB forever.
      if (h === 5 && m === 0) {
        log.info('[BehaviorScheduler] Revalidating stale knowledge conflicts');
        await revalidateStaleConflicts().catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Conflict revalidation failed');
        });
      }

      // 6 AM: project health monitoring
      if (h === 6 && m === 0) {
        log.info('[BehaviorScheduler] Running project health scan');
        await runProjectHealthScan().catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Project health scan failed');
        });
      }

      // 9 AM: knowledge reminders + Monday weekly review
      if (h === 9 && m === 0) {
        log.info('[BehaviorScheduler] Triggering knowledge reminder scan');
        await scanAndRemind().catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to scan knowledge reminders');
        });
        if (dow === 1) {
          log.info('[BehaviorScheduler] Triggering AI weekly review generation');
          await generateWeeklyReview(prisma).catch((err: Error) => {
            log.error({ err }, '[BehaviorScheduler] Weekly review generation failed');
          });
        }
      }
    }, 60_000);

    this.intervalIds.push(tick);

    // Initial execution (at server startup)
    this.runInitialUpdate();
  }

  /**
   * Execute initial update
   */
  private static async runInitialUpdate() {
    log.info('[BehaviorScheduler] Running initial behavior summary update');

    try {
      await UserBehaviorService.updateBehaviorSummary(1, 'daily');
      await UserBehaviorService.updateBehaviorSummary(1, 'weekly');
      await UserBehaviorService.updateBehaviorSummary(1, 'monthly');
      log.info('[BehaviorScheduler] Initial update completed');
    } catch (error) {
      log.error({ err: error }, '[BehaviorScheduler] Initial update failed');
    }
  }

  /**
   * Stop scheduler
   */
  static stop() {
    log.info('[BehaviorScheduler] Stopping behavior summary update scheduler');
    this.intervalIds.forEach((id) => clearInterval(id));
    this.intervalIds = [];
  }
}

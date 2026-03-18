import { UserBehaviorService } from './userBehaviorService';
import { createLogger } from '../../config/logger';
import { memoryTaskQueue } from '../../services/memory';
import { scanAndRemind } from '../../services/memory/knowledge-reminder';
import { generateOptimizationRules } from '../../services/workflow/workflow-learning-optimizer';
import { processAllPendingRecurrences } from '../../services/recurring-task-service';
import { prisma } from '../../config/database';

const log = createLogger('behavior-scheduler');

export class BehaviorScheduler {
  private static intervalIds: NodeJS.Timeout[] = [];

  /**
   * Start scheduler
   */
  static start() {
    log.info('[BehaviorScheduler] Starting behavior summary update scheduler');

    // Update daily summary at the top of every hour
    const dailyInterval = setInterval(async () => {
      const now = new Date();
      if (now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Updating daily behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'daily');
      }
    }, 60 * 1000); // Check every minute

    // Update weekly summary at midnight daily
    const weeklyInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Updating weekly behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'weekly');
      }
    }, 60 * 1000); // Check every minute

    // Update monthly summary at midnight on the 1st of each month
    const monthlyInterval = setInterval(async () => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Updating monthly behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'monthly');
      }
    }, 60 * 1000); // Check every minute

    // Execute knowledge consolidation at midnight daily
    const consolidationInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Triggering knowledge consolidation');
        await memoryTaskQueue.enqueue('consolidate', {}).catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to enqueue consolidation');
        });
      }
    }, 60 * 1000);

    // Execute forgetting sweep at 2 AM daily
    const forgettingSweepInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 2 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Triggering forgetting sweep');
        await memoryTaskQueue.enqueue('forget_sweep', {}).catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to enqueue forgetting sweep');
        });
      }
    }, 60 * 1000);

    // Execute knowledge reminder scan at 9 AM daily
    const knowledgeReminderInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 9 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Triggering knowledge reminder scan');
        await scanAndRemind().catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to scan knowledge reminders');
        });
      }
    }, 60 * 1000);

    // Generate workflow optimization rules at 3 AM daily
    const workflowLearningInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 3 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Triggering workflow optimization rule generation');
        await generateOptimizationRules().catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to generate optimization rules');
        });
      }
    }, 60 * 1000);

    // Process recurring tasks every hour
    const recurringTaskInterval = setInterval(async () => {
      const now = new Date();
      if (now.getMinutes() === 0) {
        const currentHour = now.getHours();
        log.info(`[BehaviorScheduler] Processing recurring tasks at hour ${currentHour}`);
        await processAllPendingRecurrences(prisma, currentHour).catch((err: Error) => {
          log.error({ err }, '[BehaviorScheduler] Failed to process recurring tasks');
        });
      }
    }, 60 * 1000);

    this.intervalIds.push(
      dailyInterval,
      weeklyInterval,
      monthlyInterval,
      consolidationInterval,
      forgettingSweepInterval,
      knowledgeReminderInterval,
      workflowLearningInterval,
      recurringTaskInterval,
    );

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

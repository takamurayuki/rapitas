import { UserBehaviorService } from './userBehaviorService';
import { createLogger } from '../../config/logger';

const log = createLogger('behavior-scheduler');

export class BehaviorScheduler {
  private static intervalIds: NodeJS.Timeout[] = [];

  /**
   * スケジューラーを開始
   */
  static start() {
    log.info('[BehaviorScheduler] Starting behavior summary update scheduler');

    // 毎時0分に日次サマリーを更新
    const dailyInterval = setInterval(async () => {
      const now = new Date();
      if (now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Updating daily behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'daily');
      }
    }, 60 * 1000); // 1分ごとにチェック

    // 毎日0時に週次サマリーを更新
    const weeklyInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Updating weekly behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'weekly');
      }
    }, 60 * 1000); // 1分ごとにチェック

    // 毎月1日0時に月次サマリーを更新
    const monthlyInterval = setInterval(async () => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        log.info('[BehaviorScheduler] Updating monthly behavior summary');
        await UserBehaviorService.updateBehaviorSummary(1, 'monthly');
      }
    }, 60 * 1000); // 1分ごとにチェック

    this.intervalIds.push(dailyInterval, weeklyInterval, monthlyInterval);

    // 初回実行（サーバー起動時）
    this.runInitialUpdate();
  }

  /**
   * 初回更新を実行
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
   * スケジューラーを停止
   */
  static stop() {
    log.info('[BehaviorScheduler] Stopping behavior summary update scheduler');
    this.intervalIds.forEach(id => clearInterval(id));
    this.intervalIds = [];
  }
}
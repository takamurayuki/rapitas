/**
 * イベント管理
 * エージェントオーケストレーターのイベント配信機能を担当
 */
import { createLogger } from '../../../config/logger';
import type { EventListener, OrchestratorEvent } from './types';

const logger = createLogger('event-manager');

/**
 * イベント管理クラス
 */
export class EventManager {
  private eventListeners: Set<EventListener> = new Set();

  /**
   * イベントリスナーを追加
   */
  addEventListener(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * イベントリスナーを削除
   */
  removeEventListener(listener: EventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * イベントを発火
   */
  emitEvent(event: OrchestratorEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ err: error }, 'Error in event listener');
      }
    }
  }
}

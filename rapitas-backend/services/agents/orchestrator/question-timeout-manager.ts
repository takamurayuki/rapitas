/**
 * 質問タイムアウト・継続ロック管理
 * AgentOrchestratorから質問タイムアウトと継続実行のロック管理を分離
 */
import { createLogger } from '../../../config/logger';
import { DEFAULT_QUESTION_TIMEOUT_SECONDS, type QuestionKey } from '../question-detection';
import type { OrchestratorEvent } from './types';

const logger = createLogger('question-timeout-manager');

/**
 * 質問タイムアウト管理情報
 */
type QuestionTimeoutInfo = {
  executionId: number;
  taskId: number;
  questionKey?: QuestionKey;
  questionStartedAt: Date;
  timeoutTimer: NodeJS.Timeout;
};

/**
 * 継続実行のロック状態を管理
 * 同一executionIdに対する重複実行を防止
 */
type ContinuationLockInfo = {
  executionId: number;
  lockedAt: Date;
  source: 'user_response' | 'auto_timeout';
};

/**
 * タイムアウトハンドラのコールバック型
 */
export type TimeoutHandler = (executionId: number, taskId: number) => Promise<void>;

/**
 * イベント発火のコールバック型
 */
export type EventEmitter = (event: OrchestratorEvent) => void;

/**
 * 質問タイムアウトとロックの管理クラス
 */
export class QuestionTimeoutManager {
  private questionTimeouts: Map<number, QuestionTimeoutInfo> = new Map();
  private continuationLocks: Map<number, ContinuationLockInfo> = new Map();
  private timeoutHandler: TimeoutHandler | null = null;
  private eventEmitter: EventEmitter | null = null;

  /**
   * タイムアウト発生時のハンドラを設定
   */
  setTimeoutHandler(handler: TimeoutHandler): void {
    this.timeoutHandler = handler;
  }

  /**
   * イベント発火用コールバックを設定
   */
  setEventEmitter(emitter: EventEmitter): void {
    this.eventEmitter = emitter;
  }

  /**
   * 質問タイムアウトを開始
   */
  startQuestionTimeout(executionId: number, taskId: number, questionKey?: QuestionKey): void {
    // 既存のタイムアウトがあればキャンセル
    this.cancelQuestionTimeout(executionId);

    const timeoutSeconds = questionKey?.timeout_seconds || DEFAULT_QUESTION_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;

    logger.info(
      `[QuestionTimeoutManager] Starting question timeout for execution ${executionId}: ${timeoutSeconds}s`,
    );

    const timeoutTimer = setTimeout(async () => {
      logger.info(
        `[QuestionTimeoutManager] Question timeout triggered for execution ${executionId}`,
      );
      if (this.timeoutHandler) {
        await this.timeoutHandler(executionId, taskId);
      }
    }, timeoutMs);

    this.questionTimeouts.set(executionId, {
      executionId,
      taskId,
      questionKey,
      questionStartedAt: new Date(),
      timeoutTimer,
    });

    // タイムアウトイベントを発火（フロントエンドでカウントダウン表示用）
    if (this.eventEmitter) {
      this.eventEmitter({
        type: 'execution_output',
        executionId,
        sessionId: 0,
        taskId,
        data: {
          questionTimeoutStarted: true,
          questionTimeoutSeconds: timeoutSeconds,
          questionTimeoutDeadline: new Date(Date.now() + timeoutMs).toISOString(),
        },
        timestamp: new Date(),
      });
    }
  }

  /**
   * 質問タイムアウトをキャンセル
   */
  cancelQuestionTimeout(executionId: number): void {
    const timeoutInfo = this.questionTimeouts.get(executionId);
    if (timeoutInfo) {
      clearTimeout(timeoutInfo.timeoutTimer);
      this.questionTimeouts.delete(executionId);
      logger.info(
        `[QuestionTimeoutManager] Question timeout cancelled for execution ${executionId}`,
      );
    }
  }

  /**
   * 全ての質問タイムアウトをキャンセル
   */
  cancelAllTimeouts(): void {
    for (const [executionId, timeoutInfo] of this.questionTimeouts) {
      clearTimeout(timeoutInfo.timeoutTimer);
      logger.info(
        `[QuestionTimeoutManager] Cancelled question timeout for execution ${executionId}`,
      );
    }
    this.questionTimeouts.clear();
  }

  /**
   * 継続実行のロックを取得
   * @returns ロック取得に成功した場合はtrue、既にロックされている場合はfalse
   */
  tryAcquireContinuationLock(
    executionId: number,
    source: 'user_response' | 'auto_timeout',
  ): boolean {
    const existingLock = this.continuationLocks.get(executionId);
    if (existingLock) {
      logger.info(
        `[QuestionTimeoutManager] Continuation lock already held for execution ${executionId} by ${existingLock.source}`,
      );
      return false;
    }

    this.continuationLocks.set(executionId, {
      executionId,
      lockedAt: new Date(),
      source,
    });
    logger.info(
      `[QuestionTimeoutManager] Continuation lock acquired for execution ${executionId} by ${source}`,
    );
    return true;
  }

  /**
   * 継続実行のロックを解放
   */
  releaseContinuationLock(executionId: number): void {
    const lock = this.continuationLocks.get(executionId);
    if (lock) {
      this.continuationLocks.delete(executionId);
      logger.info(
        `[QuestionTimeoutManager] Continuation lock released for execution ${executionId}`,
      );
    }
  }

  /**
   * 継続実行のロックが取得されているか確認
   */
  hasContinuationLock(executionId: number): boolean {
    return this.continuationLocks.has(executionId);
  }

  /**
   * 全ての継続ロックを解放
   */
  clearAllLocks(): void {
    this.continuationLocks.clear();
  }

  /**
   * 特定の実行の質問タイムアウト情報を取得
   */
  getQuestionTimeoutInfo(executionId: number): {
    remainingSeconds: number;
    deadline: Date;
    questionKey?: QuestionKey;
  } | null {
    const timeoutInfo = this.questionTimeouts.get(executionId);
    if (!timeoutInfo) {
      return null;
    }

    const timeoutSeconds =
      timeoutInfo.questionKey?.timeout_seconds || DEFAULT_QUESTION_TIMEOUT_SECONDS;
    const deadline = new Date(timeoutInfo.questionStartedAt.getTime() + timeoutSeconds * 1000);
    const remainingSeconds = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 1000));

    return {
      remainingSeconds,
      deadline,
      questionKey: timeoutInfo.questionKey,
    };
  }

  /**
   * 質問タイプに応じたデフォルト回答を生成
   */
  generateDefaultResponse(
    questionKey?: QuestionKey,
    questionText?: string,
    questionDetails?: string | null,
  ): string {
    // 質問詳細からオプションがある場合は最初の選択肢を使用
    if (questionDetails) {
      let details: {
        options?: Array<{ label: string; description?: string }>;
      } | null = null;
      try {
        details = JSON.parse(questionDetails) as {
          options?: Array<{ label: string; description?: string }>;
        };
      } catch {
        details = null;
      }

      if (details?.options && Array.isArray(details.options) && details.options.length > 0) {
        // 最初の選択肢（通常は推奨オプション）を選択
        const firstOption = details.options[0];
        return firstOption.label || '1';
      }
    }

    // 質問カテゴリに応じたデフォルト回答
    if (questionKey?.question_type) {
      switch (questionKey.question_type) {
        case 'confirmation':
          return 'はい';
        case 'selection':
          return '1';
        case 'clarification':
        default:
          return 'デフォルトの設定で続行してください';
      }
    }

    // 質問テキストから推測
    if (questionText) {
      const text = questionText.toLowerCase();

      if (text.includes('y/n') || text.includes('[y/n]') || text.includes('(yes/no)')) {
        return 'y';
      }

      if (
        text.includes('よろしいですか') ||
        text.includes('続けますか') ||
        text.includes('proceed') ||
        text.includes('continue')
      ) {
        return 'はい';
      }
    }

    return '続行してください';
  }
}

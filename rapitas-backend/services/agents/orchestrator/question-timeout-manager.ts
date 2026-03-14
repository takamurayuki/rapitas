/**
 * QuestionTimeoutManager
 *
 * Manages question timeouts and continuation execution locks,
 * extracted from AgentOrchestrator.
 */
import { createLogger } from '../../../config/logger';
import { DEFAULT_QUESTION_TIMEOUT_SECONDS, type QuestionKey } from '../question-detection';
import type { OrchestratorEvent } from './types';

const logger = createLogger('question-timeout-manager');

/**
 * Question timeout tracking info.
 */
type QuestionTimeoutInfo = {
  executionId: number;
  taskId: number;
  questionKey?: QuestionKey;
  questionStartedAt: Date;
  timeoutTimer: NodeJS.Timeout;
};

/**
 * Continuation lock state.
 * Prevents duplicate execution for the same executionId.
 */
type ContinuationLockInfo = {
  executionId: number;
  lockedAt: Date;
  source: 'user_response' | 'auto_timeout';
};

/**
 * Timeout handler callback type.
 */
export type TimeoutHandler = (executionId: number, taskId: number) => Promise<void>;

/**
 * Event emitter callback type.
 */
export type EventEmitter = (event: OrchestratorEvent) => void;

/**
 * Manages question timeouts and continuation execution locks.
 */
export class QuestionTimeoutManager {
  private questionTimeouts: Map<number, QuestionTimeoutInfo> = new Map();
  private continuationLocks: Map<number, ContinuationLockInfo> = new Map();
  private timeoutHandler: TimeoutHandler | null = null;
  private eventEmitter: EventEmitter | null = null;

  /**
   * Set the timeout handler.
   */
  setTimeoutHandler(handler: TimeoutHandler): void {
    this.timeoutHandler = handler;
  }

  /**
   * Set the event emitter callback.
   */
  setEventEmitter(emitter: EventEmitter): void {
    this.eventEmitter = emitter;
  }

  /**
   * Start a question timeout.
   */
  startQuestionTimeout(executionId: number, taskId: number, questionKey?: QuestionKey): void {
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

    // Emit timeout event for frontend countdown display
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
   * Cancel a question timeout.
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
   * Cancel all question timeouts.
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
   * Acquire a continuation lock.
   * @returns true if lock acquired, false if already locked.
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
   * Release a continuation lock.
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
   * Check if a continuation lock is held.
   */
  hasContinuationLock(executionId: number): boolean {
    return this.continuationLocks.has(executionId);
  }

  /**
   * Release all continuation locks.
   */
  clearAllLocks(): void {
    this.continuationLocks.clear();
  }

  /**
   * Get question timeout info for a specific execution.
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
   * Generate a default response based on question type.
   */
  generateDefaultResponse(
    questionKey?: QuestionKey,
    questionText?: string,
    questionDetails?: string | null,
  ): string {
    // NOTE: If options are available, pick the first one (usually the recommended option)
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
          const firstOption = details.options[0];
        return firstOption.label || '1';
      }
    }

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

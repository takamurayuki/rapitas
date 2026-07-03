/**
 * question-timeout-manager.test
 *
 * Covers: real-timer countdown/fire behaviour for startQuestionTimeout
 * (including default-seconds fallback, restart-cancels-previous-timer, and
 * cancelAllTimeouts), continuation-lock mutual exclusion, and every branch of
 * generateDefaultResponse's fallback chain (parsed options → question_type →
 * questionText keyword sniffing → generic default).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { QuestionTimeoutManager } = await import('./question-timeout-manager');

import { DEFAULT_QUESTION_TIMEOUT_SECONDS, type QuestionKey } from '../question-detection';
import type { OrchestratorEvent } from './types';

/** Build a minimal QuestionKey with a given timeout, for real-timer tests. */
function makeKey(
  timeoutSeconds: number,
  questionType: QuestionKey['question_type'] = 'clarification',
): QuestionKey {
  return {
    status: 'awaiting_user_input',
    question_id: 'q',
    question_type: questionType,
    requires_response: true,
    timeout_seconds: timeoutSeconds,
  };
}

describe('QuestionTimeoutManager — question timeout firing', () => {
  let manager: InstanceType<typeof QuestionTimeoutManager>;

  beforeEach(() => {
    manager = new QuestionTimeoutManager();
  });

  // NOTE: always clear timers — an uncancelled default-length (300s) timer
  // would otherwise keep a real Node timeout alive well past the test run.
  afterEach(() => {
    manager.cancelAllTimeouts();
  });

  test('fires the handler with (executionId, taskId) after the configured delay', async () => {
    const handler = mock(async () => {});
    manager.setTimeoutHandler(handler);
    manager.startQuestionTimeout(1, 100, makeKey(0.01));

    await new Promise((r) => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1, 100);
  });

  test('does not fire once cancelled before the deadline', async () => {
    const handler = mock(async () => {});
    manager.setTimeoutHandler(handler);
    manager.startQuestionTimeout(2, 200, makeKey(0.01));
    manager.cancelQuestionTimeout(2);

    await new Promise((r) => setTimeout(r, 50));

    expect(handler).not.toHaveBeenCalled();
  });

  test('starting a timeout again for the same executionId cancels the previous timer', async () => {
    const handler = mock(async () => {});
    manager.setTimeoutHandler(handler);
    manager.startQuestionTimeout(3, 300, makeKey(0.01));
    // Restart with a longer delay — the first (short) timer must not fire.
    manager.startQuestionTimeout(3, 300, makeKey(0.05));

    await new Promise((r) => setTimeout(r, 80));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('cancelling an unknown executionId is a no-op', () => {
    expect(() => manager.cancelQuestionTimeout(9999)).not.toThrow();
  });

  test('cancelAllTimeouts clears every pending timer', async () => {
    const handler = mock(async () => {});
    manager.setTimeoutHandler(handler);
    manager.startQuestionTimeout(4, 400, makeKey(0.01));
    manager.startQuestionTimeout(5, 500, makeKey(0.01));

    manager.cancelAllTimeouts();
    await new Promise((r) => setTimeout(r, 50));

    expect(handler).not.toHaveBeenCalled();
  });

  test('does nothing when no handler was registered (no throw on fire)', async () => {
    manager.startQuestionTimeout(6, 600, makeKey(0.01));
    await new Promise((r) => setTimeout(r, 50));
    // Reaching here without an unhandled rejection is the assertion.
    expect(true).toBe(true);
  });
});

describe('QuestionTimeoutManager — event emission', () => {
  let manager: InstanceType<typeof QuestionTimeoutManager>;

  beforeEach(() => {
    manager = new QuestionTimeoutManager();
  });

  afterEach(() => {
    manager.cancelAllTimeouts();
  });

  test('emits a questionTimeoutStarted execution_output event when an emitter is set', () => {
    const events: OrchestratorEvent[] = [];
    manager.setEventEmitter((e) => events.push(e));
    manager.startQuestionTimeout(7, 700, makeKey(60, 'confirmation'));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('execution_output');
    expect(events[0].executionId).toBe(7);
    expect(events[0].taskId).toBe(700);

    const data = events[0].data as {
      questionTimeoutStarted: boolean;
      questionTimeoutSeconds: number;
      questionTimeoutDeadline: string;
    };
    expect(data.questionTimeoutStarted).toBe(true);
    expect(data.questionTimeoutSeconds).toBe(60);
    expect(new Date(data.questionTimeoutDeadline).getTime()).toBeGreaterThan(Date.now());
  });

  test('does not throw when starting a timeout with no emitter registered', () => {
    expect(() => manager.startQuestionTimeout(8, 800, makeKey(60))).not.toThrow();
  });
});

describe('QuestionTimeoutManager.getQuestionTimeoutInfo', () => {
  let manager: InstanceType<typeof QuestionTimeoutManager>;

  beforeEach(() => {
    manager = new QuestionTimeoutManager();
  });

  afterEach(() => {
    manager.cancelAllTimeouts();
  });

  test('returns null for an execution with no tracked timeout', () => {
    expect(manager.getQuestionTimeoutInfo(123)).toBeNull();
  });

  test('returns remainingSeconds/deadline/questionKey for a tracked timeout', () => {
    const questionKey = makeKey(120, 'selection');
    manager.startQuestionTimeout(9, 900, questionKey);

    const info = manager.getQuestionTimeoutInfo(9);

    expect(info).not.toBeNull();
    expect(info?.questionKey).toEqual(questionKey);
    expect(info?.remainingSeconds).toBeGreaterThan(115);
    expect(info?.remainingSeconds).toBeLessThanOrEqual(120);
    expect(info?.deadline.getTime()).toBeGreaterThan(Date.now());
  });

  test('falls back to DEFAULT_QUESTION_TIMEOUT_SECONDS when no questionKey is given', () => {
    manager.startQuestionTimeout(10, 1000);

    const info = manager.getQuestionTimeoutInfo(10);

    expect(info).not.toBeNull();
    expect(info?.remainingSeconds).toBeGreaterThan(DEFAULT_QUESTION_TIMEOUT_SECONDS - 3);
    expect(info?.remainingSeconds).toBeLessThanOrEqual(DEFAULT_QUESTION_TIMEOUT_SECONDS);
  });
});

describe('QuestionTimeoutManager — continuation locks', () => {
  let manager: InstanceType<typeof QuestionTimeoutManager>;

  beforeEach(() => {
    manager = new QuestionTimeoutManager();
  });

  test('first acquire succeeds; a second acquire for the same executionId fails', () => {
    expect(manager.tryAcquireContinuationLock(1, 'user_response')).toBe(true);
    expect(manager.tryAcquireContinuationLock(1, 'auto_timeout')).toBe(false);
  });

  test('different executionIds get independent locks', () => {
    expect(manager.tryAcquireContinuationLock(1, 'user_response')).toBe(true);
    expect(manager.tryAcquireContinuationLock(2, 'user_response')).toBe(true);
  });

  test('release allows re-acquiring the same executionId', () => {
    manager.tryAcquireContinuationLock(1, 'user_response');
    manager.releaseContinuationLock(1);
    expect(manager.tryAcquireContinuationLock(1, 'auto_timeout')).toBe(true);
  });

  test('releasing a lock that is not held is a no-op', () => {
    expect(() => manager.releaseContinuationLock(999)).not.toThrow();
  });

  test('hasContinuationLock reflects the current lock state', () => {
    expect(manager.hasContinuationLock(1)).toBe(false);
    manager.tryAcquireContinuationLock(1, 'user_response');
    expect(manager.hasContinuationLock(1)).toBe(true);
  });

  test('clearAllLocks releases every held lock', () => {
    manager.tryAcquireContinuationLock(1, 'user_response');
    manager.tryAcquireContinuationLock(2, 'auto_timeout');
    manager.clearAllLocks();
    expect(manager.hasContinuationLock(1)).toBe(false);
    expect(manager.hasContinuationLock(2)).toBe(false);
  });
});

describe('QuestionTimeoutManager.generateDefaultResponse', () => {
  let manager: InstanceType<typeof QuestionTimeoutManager>;

  beforeEach(() => {
    manager = new QuestionTimeoutManager();
  });

  test('picks the first option label from parsed questionDetails', () => {
    const details = JSON.stringify({ options: [{ label: 'Option A' }, { label: 'Option B' }] });
    expect(manager.generateDefaultResponse(undefined, undefined, details)).toBe('Option A');
  });

  test('falls back to "1" when the first option has no label', () => {
    const details = JSON.stringify({ options: [{ description: 'unlabeled' }] });
    expect(manager.generateDefaultResponse(undefined, undefined, details)).toBe('1');
  });

  test('ignores malformed JSON in questionDetails and falls through to later branches', () => {
    expect(manager.generateDefaultResponse(undefined, undefined, '{not valid json')).toBe(
      '続行してください',
    );
  });

  test('ignores questionDetails with an empty options array', () => {
    const details = JSON.stringify({ options: [] });
    expect(manager.generateDefaultResponse(undefined, undefined, details)).toBe('続行してください');
  });

  test('confirmation question_type returns はい', () => {
    expect(manager.generateDefaultResponse(makeKey(60, 'confirmation'))).toBe('はい');
  });

  test('selection question_type returns "1"', () => {
    expect(manager.generateDefaultResponse(makeKey(60, 'selection'))).toBe('1');
  });

  test('clarification question_type returns the default-settings continuation message', () => {
    expect(manager.generateDefaultResponse(makeKey(60, 'clarification'))).toBe(
      'デフォルトの設定で続行してください',
    );
  });

  test('y/n phrased questionText returns "y"', () => {
    expect(manager.generateDefaultResponse(undefined, 'Continue? (yes/no)')).toBe('y');
  });

  test('bracketed [y/n] questionText returns "y"', () => {
    expect(manager.generateDefaultResponse(undefined, 'Proceed [y/n]')).toBe('y');
  });

  test('Japanese proceed-style questionText returns はい', () => {
    expect(manager.generateDefaultResponse(undefined, 'このまま続けますか?')).toBe('はい');
  });

  test('English proceed-style questionText returns はい', () => {
    expect(manager.generateDefaultResponse(undefined, 'Do you want to proceed?')).toBe('はい');
  });

  test('falls back to the generic continuation message when nothing matches', () => {
    expect(manager.generateDefaultResponse()).toBe('続行してください');
  });
});

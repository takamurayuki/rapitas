/**
 * verify-completion-inflight.test
 *
 * Task 580: the runner's fixed 60s verify-settle window expired while the
 * commit/PR pipeline was still working (it needed 127s), so auto-run skipped a
 * task that then created its PR successfully. These pin the registry the
 * runner consults instead of guessing.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  registerVerifyCompletion,
  hasVerifyCompletionInFlight,
  resetVerifyCompletionRegistry,
} from './verify-completion-inflight';

// Task 660: every registration leaves a durable start/settle trace on the
// timeline. The registry imports it lazily, so this mock (installed after the
// static import above) is what that lazy import resolves to.
const appendEventMock = mock((_e: { eventType: string; payload?: Record<string, unknown> }) =>
  Promise.resolve({ id: 1 }),
);
mock.module('../memory/timeline', () => ({ appendEvent: appendEventMock }));

/** Poll until the fire-and-forget trace has landed the expected number of writes. */
async function waitForTraces(count: number): Promise<void> {
  const deadline = Date.now() + 1000;
  while (appendEventMock.mock.calls.length < count) {
    if (Date.now() > deadline) throw new Error(`expected ${count} timeline writes`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

/** A promise plus its resolver, so a test can hold work "in flight". */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('verify-completion-inflight', () => {
  beforeEach(() => {
    resetVerifyCompletionRegistry();
    appendEventMock.mockClear();
  });

  test('登録中は in-flight として報告する', () => {
    const d = deferred();
    registerVerifyCompletion(580, d.promise);
    expect(hasVerifyCompletionInFlight(580)).toBe(true);
    d.resolve();
  });

  test('未登録タスクは in-flight ではない', () => {
    expect(hasVerifyCompletionInFlight(999)).toBe(false);
  });

  test('完了すると自動的に登録解除される', async () => {
    const d = deferred();
    registerVerifyCompletion(580, d.promise);
    d.resolve();
    await d.promise;
    // finally は同一マイクロタスクキューで走る
    await Promise.resolve();
    expect(hasVerifyCompletionInFlight(580)).toBe(false);
  });

  test('失敗しても登録解除される(パイプライン例外で永久 in-flight にしない)', async () => {
    const failing = Promise.reject(new Error('gh pr create failed'));
    registerVerifyCompletion(580, failing);
    await failing.catch(() => {});
    await Promise.resolve();
    expect(hasVerifyCompletionInFlight(580)).toBe(false);
  });

  test('古い実行が遅れて完了しても、新しい実行の登録を消さない', async () => {
    const older = deferred();
    const newer = deferred();
    registerVerifyCompletion(580, older.promise);
    registerVerifyCompletion(580, newer.promise);

    older.resolve();
    await older.promise;
    await Promise.resolve();

    // 新しい方がまだ走っているので in-flight のまま。
    expect(hasVerifyCompletionInFlight(580)).toBe(true);
    newer.resolve();
  });
});

describe('verify-completion-inflight — 開始/終了のタイムライン記録 (task 660)', () => {
  beforeEach(() => {
    resetVerifyCompletionRegistry();
    appendEventMock.mockClear();
  });

  test('登録時に verify_pipeline_started を記録する', async () => {
    const d = deferred();
    registerVerifyCompletion(658, d.promise);
    await waitForTraces(1);

    expect(appendEventMock.mock.calls[0][0]).toMatchObject({
      eventType: 'verify_pipeline_started',
      payload: { taskId: 658 },
    });
    d.resolve();
  });

  test('解決時に verify_pipeline_settled(outcome=resolved, durationMs) を記録する', async () => {
    const d = deferred();
    registerVerifyCompletion(658, d.promise);
    d.resolve();
    await waitForTraces(2);

    const settled = appendEventMock.mock.calls[1][0];
    expect(settled.eventType).toBe('verify_pipeline_settled');
    expect(settled.payload).toMatchObject({ taskId: 658, outcome: 'resolved' });
    expect(typeof settled.payload?.durationMs).toBe('number');
    expect(settled.payload?.error).toBeUndefined();
  });

  test('拒否時に verify_pipeline_settled(outcome=rejected, error) を記録し、登録も解除される', async () => {
    const failing = Promise.reject(new Error('gh pr create failed'));
    registerVerifyCompletion(658, failing);
    await failing.catch(() => {});
    await waitForTraces(2);

    expect(appendEventMock.mock.calls[1][0]).toMatchObject({
      eventType: 'verify_pipeline_settled',
      payload: { taskId: 658, outcome: 'rejected', error: 'gh pr create failed' },
    });
    expect(hasVerifyCompletionInFlight(658)).toBe(false);
  });

  test('タイムライン書き込みが失敗しても in-flight 判定と解除は影響を受けない', async () => {
    appendEventMock.mockImplementationOnce(() => Promise.reject(new Error('timeline down')));
    const d = deferred();
    registerVerifyCompletion(658, d.promise);
    expect(hasVerifyCompletionInFlight(658)).toBe(true);

    d.resolve();
    await d.promise;
    await Promise.resolve();
    expect(hasVerifyCompletionInFlight(658)).toBe(false);
  });
});

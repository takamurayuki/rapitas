/**
 * verify-completion-inflight.test
 *
 * Task 580: the runner's fixed 60s verify-settle window expired while the
 * commit/PR pipeline was still working (it needed 127s), so auto-run skipped a
 * task that then created its PR successfully. These pin the registry the
 * runner consults instead of guessing.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  registerVerifyCompletion,
  hasVerifyCompletionInFlight,
  resetVerifyCompletionRegistry,
} from './verify-completion-inflight';

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

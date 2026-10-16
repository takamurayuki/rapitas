import { handleInterrupted, handleFailed, handleCancelled } from '../execution-poll-terminal';
import type { PollRefs } from '../execution-poll-shared';
import type { ExecutionStreamState } from '../execution-stream-types';

function makeRefs(): PollRefs {
  return {
    lastProcessedStatusRef: { current: null },
    hasAddedFinalLogRef: { current: false },
    lastProcessedQuestionRef: { current: null },
    responseGraceUntilRef: { current: 0 },
    clearedQuestionRef: { current: null },
    terminalStatusGraceUntilRef: { current: 0 },
    lastExecutionIdRef: { current: null },
  };
}

const emptyState = () => ({ logs: [] }) as unknown as ExecutionStreamState;

describe('handleInterrupted', () => {
  // Regression: the backend's errorMessage for an interrupted execution is a
  // multi-line dump ("プロセスが中断されました。\n\n【最後の出力】\n<content>"). It used
  // to be shown verbatim in the panel's single-line error banner (squished,
  // unreadable — no whitespace preservation) while the log stream only ever
  // got a generic one-line placeholder, discarding the actual cause. Now the
  // detail should land in `logs` (one array entry per line, matching the log
  // viewer's one-line-per-entry convention) and `error` should stay short.
  it('splits the multi-line backend message into separate log entries and keeps the banner short', () => {
    const refs = makeRefs();
    const data = {
      executionStatus: 'interrupted',
      errorMessage: 'プロセスが中断されました。\n\n【最後の出力】\nline one\nline two',
    };

    const updater = handleInterrupted(data, refs);
    expect(updater).not.toBeNull();
    const state = updater!(emptyState());

    expect(state.error).toBe('実行が中断されました');
    expect(state.logs).toEqual([
      '[中断] 実行が中断されました。',
      '【最後の出力】',
      'line one',
      'line two',
    ]);
    expect(state.status).toBe('failed');
    expect(state.isRunning).toBe(false);
  });

  it('falls back to the generic tag line when no errorMessage is present', () => {
    const refs = makeRefs();
    const updater = handleInterrupted({ executionStatus: 'interrupted' }, refs);
    const state = updater!(emptyState());

    expect(state.error).toBe('実行が中断されました');
    expect(state.logs).toEqual(['[中断] 実行が中断されました。']);
  });

  it('does not re-emit once the final log has already been added for this status', () => {
    const refs = makeRefs();
    const data = { executionStatus: 'interrupted', errorMessage: 'プロセスが中断されました。' };

    const first = handleInterrupted(data, refs);
    first!(emptyState());
    expect(handleInterrupted(data, refs)).toBeNull();
  });

  it('skips during the post-answer grace period', () => {
    const refs = makeRefs();
    refs.lastProcessedStatusRef.current = 'responding';
    refs.responseGraceUntilRef.current = Date.now() + 60_000;

    expect(handleInterrupted({ executionStatus: 'interrupted' }, refs)).toBeNull();
  });
});

describe('handleFailed', () => {
  it('embeds the error message in the log with the [Error] tag', () => {
    const refs = makeRefs();
    const updater = handleFailed({ executionStatus: 'failed', errorMessage: 'boom' }, refs);
    const state = updater!(emptyState());

    expect(state.error).toBe('boom');
    expect(state.logs.join('')).toContain('[Error] boom');
    expect(state.status).toBe('failed');
  });
});

describe('handleCancelled', () => {
  it('marks the run cancelled with the shared cancelledLog message', () => {
    const refs = makeRefs();
    const updater = handleCancelled({ executionStatus: 'cancelled' }, refs);
    const state = updater!(emptyState());

    expect(state.status).toBe('cancelled');
    expect(state.logs.join('')).toContain('実行が停止されました');
  });
});

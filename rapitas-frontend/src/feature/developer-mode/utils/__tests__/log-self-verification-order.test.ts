/**
 * log-self-verification-order tests
 *
 * Task 1582: the log showed 「実行完了」 while self-verification was still
 * running. Within a run that announced `[SelfVerification] waiting`, the
 * completion line must be held back until the matching result line arrives,
 * then placed right after it. Runs without the marker are left untouched.
 */
import { orderSelfVerificationResults } from '../log-self-verification-order';

const START = '[Claude Code] Starting execution...';
const WAIT = '[SelfVerification] waiting runId=r1';
const RESULT_OK = '[SelfVerification] result runId=r1 ok=true unverifiable=false passed=5 failed=0';
const DONE = '[Result: success (88.3s) $0.12]';

describe('orderSelfVerificationResults', () => {
  test('hides the completion line while the result has not arrived yet', () => {
    expect(orderSelfVerificationResults([START, 'work', WAIT, DONE])).toEqual([
      START,
      'work',
      WAIT,
    ]);
  });

  test('hides a completion line that came before the waiting line, too', () => {
    expect(orderSelfVerificationResults([START, DONE, WAIT])).toEqual([START, WAIT]);
  });

  test('moves the completion line right after the result line', () => {
    expect(orderSelfVerificationResults([START, WAIT, DONE, 'tail', RESULT_OK])).toEqual([
      START,
      WAIT,
      'tail',
      RESULT_OK,
      DONE,
    ]);
  });

  test('keeps the completion line in place when it already follows the result', () => {
    const lines = [START, WAIT, RESULT_OK, DONE];
    expect(orderSelfVerificationResults(lines)).toEqual(lines);
  });

  test('waits for every announced run before showing completion', () => {
    const wait2 = '[SelfVerification] waiting runId=r2';
    const result2 =
      '[SelfVerification] result runId=r2 ok=false unverifiable=false passed=3 failed=1';
    expect(orderSelfVerificationResults([START, WAIT, RESULT_OK, wait2, DONE])).toEqual([
      START,
      WAIT,
      RESULT_OK,
      wait2,
    ]);
    expect(orderSelfVerificationResults([START, WAIT, RESULT_OK, wait2, DONE, result2])).toEqual([
      START,
      WAIT,
      RESULT_OK,
      wait2,
      result2,
      DONE,
    ]);
  });

  test('leaves logs without self-verification markers unchanged', () => {
    const lines = [START, 'work', DONE];
    expect(orderSelfVerificationResults(lines)).toBe(lines);
  });

  test('only reorders the run that waited, not an earlier run', () => {
    const lines = [START, DONE, START, WAIT, '[Result: success (2.0s)]'];
    expect(orderSelfVerificationResults(lines)).toEqual([START, DONE, START, WAIT]);
  });

  test('an empty log stays empty', () => {
    expect(orderSelfVerificationResults([])).toEqual([]);
  });
});

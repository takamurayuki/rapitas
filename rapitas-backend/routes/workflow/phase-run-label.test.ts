/**
 * phase-run-label — what one run inside a log round was
 *
 * 2026-11-26: a verify round showed "Model: gpt-6-astra" then two empty
 * dividers 「実行 2/3」「実行 3/3」. Those runs are the diff-review jurors: they
 * write no log lines, only a one-line JSON result in `output`, so the pane had
 * nothing to show and no way to say what they were.
 */
import { describe, it, expect } from 'bun:test';
import { describePhaseRun } from './phase-run-label';

describe('describePhaseRun', () => {
  it('reads a juror run: seat, model, its own verdict and finding count', () => {
    expect(
      describePhaseRun({
        id: 7555,
        command: 'adversarial-review',
        output:
          '{"kind":"adversarial-review","juror":"chatgpt:gpt-6-astra","seatId":"reviewer-1","jurorVerdict":"fail","panelVerdict":"fail","findings":1}',
      }),
    ).toEqual({
      executionId: 7555,
      review: { seatId: 'reviewer-1', model: 'gpt-6-astra', verdict: 'fail', findings: 1 },
    });
  });

  it('describes an agent run as a plain run', () => {
    expect(describePhaseRun({ id: 7542, command: '## システム指示 …', output: '' })).toEqual({
      executionId: 7542,
    });
  });

  it('keeps a juror run whose output cannot be read, without inventing a verdict', () => {
    expect(describePhaseRun({ id: 1, command: 'adversarial-review', output: 'not json' })).toEqual({
      executionId: 1,
      review: { seatId: null, model: null, verdict: null, findings: null },
    });
  });
});

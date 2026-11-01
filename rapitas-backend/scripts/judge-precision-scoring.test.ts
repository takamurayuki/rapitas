/**
 * judge-precision-scoring.test
 *
 * Scoring for the one gate in this repository that a model decides.
 *
 * Thirteen checks in `automated-verifier` are deterministic; the adversarial
 * diff review is not, and it has never been measured against anything but
 * hand-written fixtures. Measured 2026-10-21 over 876 recorded reviews, its
 * panel has collapsed to a single juror (209/209 in October), and back when a
 * second opinion still existed, 51.4% of that juror's FAIL verdicts were
 * contested by another model.
 *
 * So this scorer has to answer two questions and never confuse them: how often
 * does the judge fail a diff that shipped (false fail), and how often does it
 * pass a diff with a plan item deliberately removed (miss). A scorer that
 * reports zero for both is broken, not perfect — the tests below pin that down
 * before anything calls a model.
 */
import { describe, expect, test } from 'bun:test';
import {
  ablateStructuredDiff,
  parseUnifiedDiff,
  scoreArm,
  bootstrapInterval,
  type CaseRuns,
  type JudgeRun,
} from './judge-precision-scoring';

const run = (verdict: JudgeRun['verdict'], citedRemoved = false): JudgeRun => ({
  verdict,
  citedRemoved,
});

describe('removing one implemented plan item from a diff', () => {
  const files = [
    { filename: 'src/a.ts', status: 'modified', additions: 4, deletions: 0 },
    { filename: 'src/big.ts', status: 'added', additions: 40, deletions: 0 },
    { filename: 'src/big.test.ts', status: 'added', additions: 60, deletions: 0 },
  ];

  test('drops the source file carrying the most new code', () => {
    const { files: left, removed } = ablateStructuredDiff(files);
    expect(removed).toBe('src/big.ts');
    expect(left.map((f) => f.filename)).toEqual(['src/a.ts', 'src/big.test.ts']);
  });

  test('never ablates the test file, however large', () => {
    // Removing the test would make the diff "untested", which the coverage
    // gate already catches deterministically. The judge is being measured on
    // whether it notices MISSING IMPLEMENTATION.
    const { removed } = ablateStructuredDiff([
      { filename: 'src/x.test.ts', status: 'added', additions: 900, deletions: 0 },
      { filename: 'src/x.ts', status: 'added', additions: 3, deletions: 0 },
    ]);
    expect(removed).toBe('src/x.ts');
  });

  test('never ablates a generated artifact', () => {
    // A diff that only loses regenerated output is still a complete
    // implementation, so the judge would be right to pass it.
    const { removed } = ablateStructuredDiff([
      {
        filename: 'rapitas-frontend/messages/ja.json',
        status: 'modified',
        additions: 500,
        deletions: 0,
      },
      { filename: 'src/y.ts', status: 'modified', additions: 2, deletions: 0 },
    ]);
    expect(removed).toBe('src/y.ts');
  });

  test('refuses a diff it cannot ablate honestly', () => {
    // One source file only: removing it leaves an empty diff, which the
    // completion gate rejects before any judge sees it.
    expect(
      ablateStructuredDiff([
        { filename: 'src/only.ts', status: 'added', additions: 9, deletions: 0 },
      ]).removed,
    ).toBeNull();
    expect(ablateStructuredDiff([]).removed).toBeNull();
  });
});

describe('reading a merged PR back into changed files', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '+added one',
    '-gone',
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+first',
    '+second',
  ].join('\n');

  test('names each file and counts its real added and removed lines', () => {
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => f.filename)).toEqual(['src/a.ts', 'src/new.ts']);
    // The +++/--- headers are not content; counting them would inflate every
    // file by one in each direction and pick the wrong ablation target.
    expect(files[0]).toMatchObject({ additions: 1, deletions: 1, status: 'modified' });
    expect(files[1]).toMatchObject({ additions: 2, deletions: 0, status: 'added' });
  });

  test('keeps each file patch with its own hunks', () => {
    const files = parseUnifiedDiff(diff);
    expect(files[0].patch).toContain('+added one');
    expect(files[0].patch).not.toContain('+second');
  });

  test('has nothing to say about an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('scoring one arm', () => {
  test('counts a fail on a shipped diff as wrong', () => {
    const cases: CaseRuns[] = [
      { caseId: 'pr-1', runs: [run('pass'), run('pass')] },
      { caseId: 'pr-2', runs: [run('fail'), run('pass')] },
    ];
    const r = scoreArm('clean', cases);
    expect(r.judgedRuns).toBe(4);
    expect(r.wrongRuns).toBe(1);
    expect(r.wrongRate).toBeCloseTo(0.25, 6);
  });

  test('counts a pass on an ablated diff as wrong', () => {
    // The same tally must invert with the arm, or the harness would report a
    // judge that passes everything as perfectly precise.
    const cases: CaseRuns[] = [{ caseId: 'pr-1', runs: [run('pass'), run('fail')] }];
    expect(scoreArm('ablated', cases).wrongRuns).toBe(1);
    expect(scoreArm('clean', cases).wrongRuns).toBe(1);
  });

  test('leaves unknown out of the rate but still reports it', () => {
    // 'unknown' is the jury being unavailable — an availability fact, not a
    // judgement. Folding it into either rate would hide an outage as accuracy.
    const r = scoreArm('clean', [
      { caseId: 'pr-1', runs: [run('unknown'), run('unknown'), run('pass')] },
    ]);
    expect(r.unknownRuns).toBe(2);
    expect(r.judgedRuns).toBe(1);
    expect(r.wrongRate).toBe(0);
  });

  test('reports a case whose repeats disagreed', () => {
    const r = scoreArm('clean', [
      { caseId: 'a', runs: [run('pass'), run('fail')] },
      { caseId: 'b', runs: [run('pass'), run('pass')] },
    ]);
    expect(r.inconsistentCases).toBe(1);
    expect(r.repeatedCases).toBe(2);
  });

  test('reports how often a fail actually named the removed file', () => {
    // A fail that cannot say what is missing gives the implementer nothing to
    // repair, so a right verdict for the wrong reason is tracked separately.
    const r = scoreArm('ablated', [{ caseId: 'a', runs: [run('fail', true), run('fail', false)] }]);
    expect(r.citedRemovedRuns).toBe(1);
    expect(r.correctRuns).toBe(2);
  });

  test('has nothing to say about no runs', () => {
    const r = scoreArm('clean', []);
    expect(r.judgedRuns).toBe(0);
    expect(r.wrongRate).toBe(0);
    expect(r.wrongRateCI).toEqual([0, 0]);
  });
});

describe('the interval', () => {
  test('resamples cases, not runs', () => {
    // Runs of one case share a diff and a prompt, so they are not independent
    // draws; resampling them would report an interval several times too narrow.
    const half = Array.from({ length: 20 }, (_, i) => ({
      caseId: `c${i}`,
      runs: i % 2 === 0 ? [run('fail'), run('fail')] : [run('pass'), run('pass')],
    }));
    const r = scoreArm('clean', half);
    expect(r.wrongRate).toBeCloseTo(0.5, 6);
    const [lo, hi] = r.wrongRateCI;
    expect(hi - lo).toBeGreaterThan(0.2);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
  });

  test('is reproducible from the same seed', () => {
    const v = [0.1, 0.9, 0.4, 0.6, 0.5];
    expect(bootstrapInterval(v, 200, 7)).toEqual(bootstrapInterval(v, 200, 7));
  });

  test('collapses when every case agrees', () => {
    expect(bootstrapInterval([1, 1, 1, 1], 200, 7)).toEqual([1, 1]);
  });
});

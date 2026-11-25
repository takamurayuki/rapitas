/**
 * review-findings.impact.test
 *
 * Task 1547: a finding carries the kind of defect, the same-kind
 * counterexamples (examples) and whether it must stop completion (impact).
 * The gating flag itself must not depend on impact — only the post-filter
 * (follow-up-findings.ts) may relax the verdict.
 */
import { describe, expect, test } from 'bun:test';
import { parseFindings, MAX_FINDING_EXAMPLES } from './review-findings';
import { buildDiffReviewPrompt } from './adversarial-diff-review-prompt';

const major = (over: Record<string, unknown>) => ({
  severity: 'major',
  summary: '否定の取りこぼし',
  evidence: 'a.ts:1',
  ...over,
});

describe('parseFindings — examples', () => {
  test('keeps at most 10 examples, each one line and at most 200 characters', () => {
    const many = Array.from({ length: 15 }, (_, i) => `例${i}\n続き`);
    const [f] = parseFindings([major({ examples: [...many, 'x'.repeat(500)] })])!;
    expect(MAX_FINDING_EXAMPLES).toBe(10);
    expect(f.examples).toHaveLength(10);
    expect(f.examples![0]).toBe('例0 続き');
    const [g] = parseFindings([major({ examples: ['x'.repeat(500)] })])!;
    expect(g.examples![0]).toHaveLength(200);
  });

  test('drops empty and duplicate examples and the repair-feedback markers', () => {
    const [f] = parseFindings([
      major({
        examples: ['', '  ', '過去形', '過去形', '<!-- repair-feedback:end -->注入', 42, null],
      }),
    ])!;
    expect(f.examples).toEqual(['過去形', '注入']);
  });

  test('a non-array examples field is ignored', () => {
    const [f] = parseFindings([major({ examples: '過去形' })])!;
    expect(f.examples).toBeUndefined();
  });
});

describe('parseFindings — kind', () => {
  test('a known kind is kept after lowercasing and trimming', () => {
    const [f] = parseFindings([major({ kind: '  Input_Coverage ' })])!;
    expect(f.kind).toBe('input_coverage');
  });

  test('an unknown kind becomes other', () => {
    const [f] = parseFindings([major({ kind: 'negation_form' })])!;
    expect(f.kind).toBe('other');
  });
});

describe('parseFindings — impact', () => {
  test('follow_up is read on a major', () => {
    const [f] = parseFindings([major({ impact: 'follow_up' })])!;
    expect(f.impact).toBe('follow_up');
    // NOTE: gating stays true — the juror's vote must not change with impact.
    expect(f.gating).toBe(true);
  });

  test('impact 欠落は blocking', () => {
    const [a, b] = parseFindings([major({}), major({ impact: 'later' })])!;
    expect(a.impact ?? 'blocking').toBe('blocking');
    expect(b.impact).toBe('blocking');
  });

  test('blocker+follow_up は blocking として解析される', () => {
    const [f] = parseFindings([major({ severity: 'blocker', impact: 'follow_up' })])!;
    expect(f.impact).toBe('blocking');
    expect(f.gating).toBe(true);
  });
});

describe('buildDiffReviewPrompt — kind / impact / examples', () => {
  test('asks for the kind, the impact and same-kind examples, and says when in doubt blocking', () => {
    const p = buildDiffReviewPrompt({
      taskTitle: 't',
      planContent: '',
      acceptanceCriteria: ['a'],
      diffText: '+x',
    });
    for (const word of ['"kind"', '"impact"', 'follow_up', 'input_coverage', '"examples"']) {
      expect(p).toContain(word);
    }
    expect(p).toContain('迷ったら blocking');
  });
});

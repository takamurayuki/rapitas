/**
 * criteria-review.test
 *
 * The researcher's criteria review is read strictly (#1561): a block that
 * cannot be acted on — unreadable, an unknown kind, a "revise" with no
 * rewrite — must not stop a task.
 */
import { describe, it, expect } from 'bun:test';
import {
  RESEARCH_CRITERIA_REVIEW_EN,
  RESEARCH_CRITERIA_REVIEW_JA,
  extractResearchCriteriaReview,
  parseCriteriaReview,
} from './criteria-review';

describe('reading the review', () => {
  it('reads a clean ok', () => {
    expect(parseCriteriaReview('{"verdict":"ok","findings":[],"proposed":[]}', 2)).toEqual({
      verdict: 'ok',
      findings: [],
      proposed: [],
    });
  });

  it('reads a revise with its findings and the rewrite, in a chatty reply', () => {
    const text =
      '点検しました。\n```json\n{"verdict":"revise","findings":[{"index":1,"kind":"unverifiable","problem":"CI は確かめられない"}],"proposed":["a.test.ts が通る"]}\n```';
    expect(parseCriteriaReview(text, 2)).toEqual({
      verdict: 'revise',
      findings: [{ index: 1, kind: 'unverifiable', problem: 'CI は確かめられない' }],
      proposed: ['a.test.ts が通る'],
    });
  });

  it('drops a finding of an unknown kind, and an index out of range', () => {
    const text = JSON.stringify({
      verdict: 'revise',
      findings: [
        { index: 0, kind: 'style', problem: '言い回し' },
        { index: 9, kind: 'ambiguous', problem: '二通りに読める' },
      ],
      proposed: ['x'],
    });
    expect(parseCriteriaReview(text, 2)?.findings).toEqual([
      { index: null, kind: 'ambiguous', problem: '二通りに読める' },
    ]);
  });

  // Nothing to act on: treated as no finding, not as a reason to stop.
  it('reads a revise with no rewrite as ok', () => {
    const text = JSON.stringify({
      verdict: 'revise',
      findings: [{ index: 0, kind: 'ambiguous', problem: 'x' }],
      proposed: [],
    });
    expect(parseCriteriaReview(text, 1)?.verdict).toBe('ok');
  });

  it('returns null for something that is not a review', () => {
    expect(parseCriteriaReview('すみません', 1)).toBeNull();
    expect(parseCriteriaReview('{"verdict":"maybe"}', 1)).toBeNull();
  });
});

describe('the researcher’s block in research.md', () => {
  it('is found after the prose', () => {
    const md = [
      '# 調査',
      '## 完了条件の点検',
      '条件1 はテストが存在しない。',
      '```json criteria-review',
      '{"verdict":"revise","findings":[{"index":0,"kind":"unverifiable","problem":"x.test.ts は存在しない"}],"proposed":["y.test.ts が通る"]}',
      '```',
    ].join('\n');
    expect(extractResearchCriteriaReview(md, 1)).toEqual({
      verdict: 'revise',
      findings: [{ index: 0, kind: 'unverifiable', problem: 'x.test.ts は存在しない' }],
      proposed: ['y.test.ts が通る'],
    });
  });

  it('is null when the researcher left it out', () => {
    expect(extractResearchCriteriaReview('# 調査\n```json\n{"a":1}\n```', 1)).toBeNull();
  });
});

describe('the instruction', () => {
  it('asks for the block the parser reads, in both languages', () => {
    expect(RESEARCH_CRITERIA_REVIEW_JA).toContain('```json criteria-review');
    expect(RESEARCH_CRITERIA_REVIEW_EN).toContain('```json criteria-review');
  });
});

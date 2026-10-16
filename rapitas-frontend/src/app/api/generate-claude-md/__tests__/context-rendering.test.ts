/**
 * context-rendering.test
 *
 * The whole point of the elicitation step is that a figure nobody gave is
 * NOT invented. Measured 2026-10-11: TempoRaid's requirements asserted 10,000
 * concurrent users, p95 150ms and 99.5% availability — none of it asked for —
 * and those numbers are what chose Redis-backed room state and a horizontally
 * scaled API. The model can only apply the "record it as an assumption" rule if
 * the prompt says which fields were left blank, so blanks must be rendered as
 * 未確認 rather than dropped.
 */

import { describe, expect, it } from 'vitest';
import { renderContext, renderReviewAnswers } from '../route';

describe('renderContext', () => {
  it('names every unanswered field as 未確認 instead of omitting it', () => {
    const block = renderContext({});
    for (const label of [
      '想定ユーザー数',
      'レイテンシ要求',
      '可用性要求',
      '予算感',
      '期限',
      '開発体制',
      '既存資産',
      '成功の定義',
      '業務ルール・法令',
    ]) {
      expect(block).toContain(`- ${label}: 未確認`);
    }
  });

  it('passes an answered field through verbatim', () => {
    const block = renderContext({ users: '同時50人', budget: '月1万円以内' });
    expect(block).toContain('- 想定ユーザー数: 同時50人');
    expect(block).toContain('- 予算感: 月1万円以内');
    // Untouched fields are still named.
    expect(block).toContain('- 期限: 未確認');
  });

  it('treats whitespace-only input as not established', () => {
    expect(renderContext({ users: '   ' })).toContain('- 想定ユーザー数: 未確認');
  });

  it('renders the same field list when the context is absent entirely', () => {
    const lines = (s: string) => s.split('\n').filter((l) => l.startsWith('- ')).length;
    expect(lines(renderContext(undefined))).toBe(lines(renderContext({})));
  });

  it('states the rule the model must apply', () => {
    expect(renderContext({})).toContain('前提と未決事項');
  });
});

describe('renderReviewAnswers', () => {
  it('is empty when there are no answers, so nothing is implied', () => {
    expect(renderReviewAnswers(undefined)).toBe('');
    expect(renderReviewAnswers('')).toBe('');
    expect(renderReviewAnswers('  \n ')).toBe('');
  });

  it('includes the answers and tells the model to clear what they settled', () => {
    const block = renderReviewAnswers('同時接続は30人です');
    expect(block).toContain('同時接続は30人です');
    expect(block).toContain('未決事項から外す');
  });
});

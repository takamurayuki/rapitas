/**
 * pr-risk-comment test
 *
 * Pins the PR comment: marker first line, score/threshold/stage, SHAP table,
 * main factor, the "reference only — humans decide" notice, and the
 * single-comment upsert (PATCH existing marker comment, else POST).
 */
import { describe, it, expect } from 'bun:test';
import { buildRiskComment, upsertRiskComment } from './pr-risk-comment';
import { COMMENT_MARKER } from './pr-risk-types';

const prediction = {
  score: 0.4213,
  baseLogit: -2.2,
  contributions: [
    { feature: 'dependency_change' as const, phi: 0.72 },
    { feature: 'file_size' as const, phi: -0.3 },
    { feature: 'author' as const, phi: 0 },
  ],
};

describe('buildRiskComment', () => {
  const body = buildRiskComment({ prediction, threshold: 0.5, stage: 'display', held: false });

  it('starts with the marker', () => {
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('shows score %, threshold and stage', () => {
    expect(body).toContain('42.1%');
    expect(body).toContain('50.0%');
    expect(body).toContain('display');
  });

  it('shows the SHAP table with every contribution and names the main factor', () => {
    expect(body).toContain('SHAP');
    expect(body).toContain('| dependency_change |');
    expect(body).toContain('+0.720');
    expect(body).toContain('-0.300');
    expect(body).toContain('主因: dependency_change');
  });

  it('carries the human-in-the-loop notice', () => {
    expect(body).toContain(
      'このスコアは参考値です。最終判定は人間が行います。偽陽性・偽陰性があり得ます。',
    );
  });

  it('states a hold when the PR was excluded from auto-merge', () => {
    const held = buildRiskComment({ prediction, threshold: 0.3, stage: 'hold', held: true });
    expect(held).toContain('自動マージを保留');
    expect(body).not.toContain('自動マージを保留');
  });
});

describe('upsertRiskComment', () => {
  it('PATCHes the existing marker comment', async () => {
    const calls: string[][] = [];
    const mode = await upsertRiskComment('/repo', 9, 'BODY', async (args) => {
      calls.push(args);
      if (args.includes('GET') || !args.includes('--method')) {
        return JSON.stringify([
          { id: 1, body: 'unrelated' },
          { id: 55, body: `${COMMENT_MARKER}\nold` },
        ]);
      }
      return '{}';
    });
    expect(mode).toBe('updated');
    expect(calls[1]).toContain('PATCH');
    expect(calls[1]).toContain('repos/{owner}/{repo}/issues/comments/55');
  });

  it('POSTs a new comment when none carries the marker', async () => {
    const calls: string[][] = [];
    const mode = await upsertRiskComment('/repo', 9, 'BODY', async (args) => {
      calls.push(args);
      return calls.length === 1 ? '[]' : '{}';
    });
    expect(mode).toBe('created');
    expect(calls[1]).toContain('POST');
    expect(calls[1]).toContain('repos/{owner}/{repo}/issues/9/comments');
  });
});

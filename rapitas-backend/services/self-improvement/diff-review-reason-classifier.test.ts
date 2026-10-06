/**
 * diff-review-reason-classifier tests
 *
 * Verifies scope-drift / plan-gap triage of adversarial diff-review reasons.
 */
import { describe, it, expect } from 'bun:test';
import { classifyDiffReviewReason } from './diff-review-reason-classifier';

describe('classifyDiffReviewReason', () => {
  it('classifies scope-drift reasons', () => {
    expect(
      classifyDiffReviewReason('差分レビュー不合格: 計画外のファイル foo.ts が混入している'),
    ).toBe('scope_drift');
    expect(
      classifyDiffReviewReason('差分レビュー不合格: タスクと無関係な変更 / unrelated edits'),
    ).toBe('scope_drift');
  });

  it('classifies plan-gap reasons', () => {
    expect(classifyDiffReviewReason('差分レビュー不合格: 受入基準2に対応するテストが未実装')).toBe(
      'plan_gap',
    );
    expect(
      classifyDiffReviewReason('差分レビュー不合格: チェックリスト項目が差分に含まれていない'),
    ).toBe('plan_gap');
  });

  it('returns unclassified when neither family matches or input is empty', () => {
    expect(classifyDiffReviewReason('差分レビュー不合格: 命名が不統一')).toBe('unclassified');
    expect(classifyDiffReviewReason('')).toBe('unclassified');
    expect(classifyDiffReviewReason(undefined)).toBe('unclassified');
  });

  it('picks the family whose keyword appears first when reasons are concatenated', () => {
    expect(
      classifyDiffReviewReason('差分レビュー不合格: 計画外の変更が混入 / 受入基準が未実装'),
    ).toBe('scope_drift');
    expect(
      classifyDiffReviewReason('差分レビュー不合格: 受入基準が未実装 / 計画外の変更が混入'),
    ).toBe('plan_gap');
  });
});

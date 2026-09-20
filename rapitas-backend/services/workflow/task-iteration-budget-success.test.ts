/**
 * task-iteration-budget-success テスト
 *
 * 成功側遷移(PR 作成・マージ待ち)の切り詰めと PR リンク済み免除の純関数を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  isSuccessSideTransitionCause,
  sliceAfterLastSuccess,
  isAwaitingMergeWithPr,
} from './task-iteration-budget-success';

const t = (cause: string | null) => ({ cause });

describe('isSuccessSideTransitionCause', () => {
  test('実在する成功 cause 2 種のみ true', () => {
    expect(isSuccessSideTransitionCause('verify_passed_awaiting_ci')).toBe(true);
    expect(isSuccessSideTransitionCause('verify_awaiting_required_merge')).toBe(true);
    expect(isSuccessSideTransitionCause('verify_repair')).toBe(false);
    expect(isSuccessSideTransitionCause('pr_created')).toBe(false);
    expect(isSuccessSideTransitionCause(null)).toBe(false);
  });
});

describe('sliceAfterLastSuccess', () => {
  test('成功なしなら入力そのまま', () => {
    const xs = [t('verify_repair'), t('verify_repair')];
    expect(sliceAfterLastSuccess(xs)).toEqual(xs);
  });
  test('成功が末尾なら空', () => {
    expect(sliceAfterLastSuccess([t('verify_repair'), t('verify_passed_awaiting_ci')])).toEqual([]);
  });
  test('成功の後の遷移だけを返す', () => {
    expect(
      sliceAfterLastSuccess([
        t('verify_repair'),
        t('verify_awaiting_required_merge'),
        t('ci_repair'),
      ]),
    ).toEqual([t('ci_repair')]);
  });
  test('成功が複数なら最後を基準にする', () => {
    expect(
      sliceAfterLastSuccess([
        t('verify_passed_awaiting_ci'),
        t('ci_repair'),
        t('verify_awaiting_required_merge'),
        t('ci_repair'),
        t('ci_repair'),
      ]),
    ).toEqual([t('ci_repair'), t('ci_repair')]);
  });
});

describe('isAwaitingMergeWithPr', () => {
  const base = { workflowStatus: 'verify_done', githubPrId: 776, lastToStatus: 'verify_done' };
  test('3 条件すべて満たすと true', () => {
    expect(isAwaitingMergeWithPr(base)).toBe(true);
  });
  test('いずれか欠けると false', () => {
    expect(isAwaitingMergeWithPr({ ...base, workflowStatus: 'in_progress' })).toBe(false);
    expect(isAwaitingMergeWithPr({ ...base, githubPrId: null })).toBe(false);
    expect(isAwaitingMergeWithPr({ ...base, lastToStatus: 'in_progress' })).toBe(false);
    expect(isAwaitingMergeWithPr({ ...base, lastToStatus: null })).toBe(false);
  });
});

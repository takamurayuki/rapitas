/**
 * auto-run-hold-check.test
 *
 * 実測した欠陥の再現（2026-10-13）。
 *
 * `autoRunExcluded` は選定側（eligibleTopLevelTodoWhere / selectNextTask）では
 * 尊重されるが、**resume 側では見られていない**。auto-run-resolve-outcome は
 * 「currentTaskId が in-progress なのにキュー項目が無い」状態を復帰とみなして
 * 無条件に再キューする。そのため保留したタスクが勝手に走り、課金される。
 *
 * 実測: #1214 に autoRunExcluded=1 を立てた直後にキュー項目 #4246 が作られて
 * 起動し $8.86 を消費。項目を cancel すると数秒で #4247 が作られた。実際に
 * 止まったのは status を blocked にしたときだけで、保留フラグは無効だった。
 *
 * 保留の判定を1か所に集め、resume 側がそれを見られるようにする。
 */
import { describe, expect, test } from 'bun:test';
import { classifyAutoRunHold } from './auto-run-hold-check';

describe('classifyAutoRunHold', () => {
  test('保留なしのタスクは held=false', () => {
    expect(
      classifyAutoRunHold({ autoRunExcluded: false, workflowDisabled: false, haltReason: null }),
    ).toEqual({ held: false, reason: null });
  });

  // この事故の核心。
  test('autoRunExcluded を保留として報告する', () => {
    expect(
      classifyAutoRunHold({ autoRunExcluded: true, workflowDisabled: false, haltReason: null }),
    ).toEqual({ held: true, reason: 'auto_run_excluded' });
  });

  test('workflowDisabled を保留として報告する', () => {
    expect(
      classifyAutoRunHold({ autoRunExcluded: false, workflowDisabled: true, haltReason: null }),
    ).toEqual({ held: true, reason: 'workflow_disabled' });
  });

  // 選定側は haltReason: null を条件にしているので、resume 側も揃える。
  // halt されたタスクを再注入すると halt を増幅する（K-10720）。
  test('haltReason を保留として報告する', () => {
    expect(
      classifyAutoRunHold({
        autoRunExcluded: false,
        workflowDisabled: false,
        haltReason: 'budget_cost_exceeded',
      }),
    ).toEqual({ held: true, reason: 'halted' });
  });

  test('複数該当時は autoRunExcluded を優先して報告する（運用者の明示的な意思）', () => {
    expect(
      classifyAutoRunHold({
        autoRunExcluded: true,
        workflowDisabled: true,
        haltReason: 'budget_time_exceeded',
      }),
    ).toEqual({ held: true, reason: 'auto_run_excluded' });
  });

  test('タスクが読めない場合は保留扱いにしない（fail open）', () => {
    // 行が読めないことを保留の証拠にすると、DB の一時障害で復帰が止まる。
    expect(classifyAutoRunHold(null)).toEqual({ held: false, reason: null });
  });

  test('フラグが未定義でも落ちない', () => {
    expect(classifyAutoRunHold({})).toEqual({ held: false, reason: null });
  });

  test('空文字の haltReason は halt ではない', () => {
    expect(classifyAutoRunHold({ haltReason: '' })).toEqual({ held: false, reason: null });
  });
});

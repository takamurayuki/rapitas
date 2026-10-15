/**
 * auto-run-theme-parked.test
 *
 * 実測した誤報の再現（2026-10-13）。
 *
 * auto-run-no-selection-watch は「キューに発行可能な項目が無い」ことを
 * 「advance が完了していない（= 系の欠陥）」と報告していた。しかしテーマが
 * 自分の仕事を全部保留されている状態では、発行可能な項目が無いのは**正常**で
 * ある。判定すべきは「キューに何かあるか」ではなく「このテーマに発行できる
 * 仕事があるか」。
 *
 * 実測: 本日の cycle ログで最多のイベントが theme.no_selection_progress の
 * 40件（19:35〜22:46、全てテーマ34）。そのときテーマ34 の非終端タスクは
 * 1214/1216/1223/1224/1225 が autoRunExcluded=1、1215 が
 * workflowStatus='awaiting_question' の計6件で、発行可能なものは1件も
 * 無かった。最も大きな信号が誤報で、本物の停止はこれに埋もれる。
 */
import { describe, expect, test } from 'bun:test';
import { classifyThemeWork, type ThemeTaskState } from './auto-run-theme-parked';

/** A task the runner would dispatch right now. */
const RUNNABLE: ThemeTaskState = {
  status: 'todo',
  workflowStatus: 'draft',
  haltReason: null,
  autoRunExcluded: false,
  workflowDisabled: false,
};

describe('classifyThemeWork', () => {
  test('発行可能なタスクが1件でもあれば runnable', () => {
    expect(classifyThemeWork([RUNNABLE])).toEqual({ parked: false, runnable: 1, pending: 1 });
  });

  // この誤報の核心。テーマ34 の実際の形。
  test('実測: 保留5件 + 回答待ち1件は parked（停止ではない）', () => {
    const verdict = classifyThemeWork([
      { ...RUNNABLE, autoRunExcluded: true }, // #1214
      { ...RUNNABLE, status: 'in-progress', workflowStatus: 'awaiting_question' }, // #1215
      { ...RUNNABLE, workflowStatus: null, autoRunExcluded: true }, // #1216
      { ...RUNNABLE, workflowStatus: null, autoRunExcluded: true }, // #1223
      { ...RUNNABLE, workflowStatus: null, autoRunExcluded: true }, // #1224
      { ...RUNNABLE, workflowStatus: null, autoRunExcluded: true }, // #1225
    ]);
    expect(verdict).toEqual({ parked: true, runnable: 0, pending: 6 });
  });

  test('1件でも発行可能なら、他が全部保留でも parked にしない', () => {
    expect(classifyThemeWork([{ ...RUNNABLE, autoRunExcluded: true }, RUNNABLE]).parked).toBe(
      false,
    );
  });

  // 保留の3フラグは D1 の classifyAutoRunHold と同じ問いを立てる。
  for (const [label, hold] of [
    ['autoRunExcluded', { autoRunExcluded: true }],
    ['workflowDisabled', { workflowDisabled: true }],
    ['haltReason', { haltReason: 'budget_cost_exceeded' }],
  ] as const) {
    test(`${label} のタスクは発行可能として数えない`, () => {
      expect(classifyThemeWork([{ ...RUNNABLE, ...hold }]).parked).toBe(true);
    });
  }

  // ランナーが拒否する workflowStatus は isDispatchableWaiter と揃える。
  for (const workflowStatus of ['awaiting_question', 'verify_done']) {
    test(`workflowStatus=${workflowStatus} は発行可能として数えない`, () => {
      expect(classifyThemeWork([{ ...RUNNABLE, workflowStatus }]).parked).toBe(true);
    });
  }

  test('status=blocked は発行可能として数えない', () => {
    expect(classifyThemeWork([{ ...RUNNABLE, status: 'blocked' }]).parked).toBe(true);
  });

  // 仕事が1件も無いのは「保留されている」のとは別の状態。park 扱いにすると
  // 「全部終わった」テーマを「人の対応待ち」と誤って報告してしまう。
  test('タスクが1件も無いテーマは parked ではない（空は保留ではない）', () => {
    expect(classifyThemeWork([])).toEqual({ parked: false, runnable: 0, pending: 0 });
  });

  test('終端タスクは数に入れない', () => {
    expect(classifyThemeWork([{ ...RUNNABLE, status: 'done' }])).toEqual({
      parked: false,
      runnable: 0,
      pending: 0,
    });
  });
});
